#Backend Code

from tkinter import N
from flask import Flask, request, jsonify, send_from_directory
import openai
from openai import OpenAI
import os
import json
from flask_cors import CORS
from pydantic import BaseModel, Field
import statistics
from typing import List, Dict, Optional, Any
from termcolor import colored
import re
import numpy as np
from dotenv import load_dotenv

#app = Flask(__name__)
app = Flask(__name__, static_folder="../frontend/build", static_url_path="")

@app.route("/")
def serve():
    return send_from_directory(app.static_folder, "index.html")

#CORS(app)
CORS(app, resources={r"/api/*": {"origins": "*"}})
load_dotenv()

client = OpenAI(
  api_key=os.getenv("OPENAI_API_KEY")
)

def generate_vega_spec(chart_type, x_field, y_field, color_field, is_histogram=int):
    if is_histogram == 0:
        spec = {
            "vegaSpec": {
                "mark": chart_type,
                "encoding": {
                    "x": {"field": x_field, "type": "quantitative" if chart_type in ["point", "line", "area"] else "ordinal"}, #"x": {"field": x_field, "type": "ordinal" if chart_type == "bar" else "quantitative"},
                    "y": {"field": y_field, "type": "quantitative"}
                },
            }
        }
        if color_field:
            spec["vegaSpec"]["encoding"]["color"] = {"field": color_field, "type": "nominal"}
    elif is_histogram == 1:
        spec = {
            "vegaSpec": {
                "mark": "bar",
                "encoding": {
                    "x": {"field": x_field, "type": "quantitative", "bin": True},
                    "y": {"aggregate": "count", "type": "quantitative"}
                },
            }
        }
        if color_field:
            spec["vegaSpec"]["encoding"]["color"] = {"field": color_field, "type": "nominal"}
    return spec


def calculate_statistics(data, field, second_field=None, group_by=None, filter_by=None):
    # Apply filtering if needed
    if filter_by:
        data = [item for item in data if item.get(filter_by['field']) == filter_by['value']]
    
    if second_field:
        # Extract values for both fields
        field_values = [float(item[field]) for item in data if field in item and item[field] != ""]
        second_field_values = [float(item[second_field]) for item in data if second_field in item and item[second_field] != ""]

        # Check that we have matching data points in both lists
        min_length = min(len(field_values), len(second_field_values))
        field_values = field_values[:min_length]
        second_field_values = second_field_values[:min_length]

        # Calculate mean, standard deviation, and correlation coefficient
        field_mean = np.mean(field_values)
        field_std = np.std(field_values)
        second_field_mean = np.mean(second_field_values)
        second_field_std = np.std(second_field_values)
        correlation_coefficient = np.corrcoef(field_values, second_field_values)[0, 1]

        return {
            "field_1": {
                "name": field,
                "mean": field_mean,
                "std_dev": field_std
            },
            "field_2": {
                "name": second_field,
                "mean": second_field_mean,
                "std_dev": second_field_std
            },
            "correlation_coefficient": correlation_coefficient
        }

    # Group data if needed
    grouped_data = {}
    if group_by:
        for item in data:
            group_key = item.get(group_by)
            if group_key:
                grouped_data.setdefault(group_key, []).append(float(item.get(field, 0)))
    else:
        # If no grouping, calculate directly on all data
        values = [float(item[field]) for item in data if field in item]
        return {
            "mean": statistics.mean(values),
            "median": statistics.median(values),
            "range": max(values) - min(values),
            "std_dev": statistics.stdev(values),
        }


    # Calculate statistics for each group
    result = {}
    for group_key, values in grouped_data.items():
        result[group_key] = {
            "mean": statistics.mean(values),
            "median": statistics.median(values),
            "range": max(values) - min(values)
        }
    return result


class GenerateVegaSpec(BaseModel):
    chart_type: str
    x_field: str
    y_field: str
    color_field: str
    is_histogram: int

calculate_statistics_schema = {
    "type": "function",
    "function": {
        "name": "CalculateStatistics",
        "description": "Calculate statistics like mean, median, range, standard deviation, and correlation for specific fields in the dataset, optionally filtering by a category or grouping by a field.",
        "parameters": {
            "type": "object",
            "properties": {
                "data": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": {
                            "type": "number"
                        }
                    },
                    "description": "Array of dictionaries where each dictionary represents a row of data. Each dictionary contains field names as keys and numerical values as data."
                },
                "field": {
                    "type": "string",
                    "description": "The field name in the dataset for which to calculate the statistics."
                },
                "second_field": {
                    "type": "string",
                    "description": "Optional second field name in the dataset for which to calculate correlation and summary statistics.",
                    "nullable": True
                },
                "group_by": {
                    "type": "string",
                    "description": "Optional field name to group data by categories.",
                    "nullable": True
                },
                "filter_by": {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string"},
                        "value": {"type": "string"}
                    },
                    "description": "Optional field and value to filter data.",
                    "nullable": True
                }
            },
            "required": ["data", "field"],
            "additionalProperties": False
        }
    }
}


tool_map = {
    "GenerateVegaSpec": generate_vega_spec,
    "CalculateStatistics": calculate_statistics
}

# Register tools
tools = [
    openai.pydantic_function_tool(GenerateVegaSpec),
    calculate_statistics_schema #openai.pydantic_function_tool(CalculateStatistics)
]
print(tools)

def extract_json_from_markdown(text):
    """
    Extract JSON code block from markdown formatted text.
    """
    json_match = re.search(r"```json\s+({.*?})\s+```", text, re.DOTALL)
    if json_match:
        return json_match.group(1)
    return None

def extract_requested_statistic(question):
    """
    Extract the requested statistic from the user's question.
    Possible statistics are: mean, median, range.
    """
    question_lower = question.lower()
    print(colored(question_lower, "yellow"))
    if ("mean" or "average" or "expected value") in question_lower:
        return "mean"
    elif "median" in question_lower:
        return "median"
    elif "range" in question_lower:
        return "range"
    return None


def query(user_message, question, system_prompt, tools, tool_map, csv_full, max_iterations=10):
    messages = [{"role": "system", "content": system_prompt}]
    messages.append({"role": "user", "content": question})
    print(colored("Messages Initialized.", "yellow"))
    # Initialize iteration counter
    i = 0
    
    requested_statistic = extract_requested_statistic(user_message)
    print(colored(requested_statistic, "yellow"))
    while i < max_iterations:
        print(colored("In While Loop.", "yellow"))
        i += 1
        print(colored(f"Iteration: {i}", "yellow"))  # Debug: print the iteration number in yellow

        # Call OpenAI API
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",  # Specify model and add any parameters if needed
            messages=messages,
            tools=tools #[openai.pydantic_function_tool(GenerateVegaSpec)]
        )
        print(colored("Response Initialized.", "yellow"))
        # Debug: print the API response
        print(colored("API Response:", "blue"), response)
        response_content = response.choices[0].message.content
        # Check if the response has a direct message content
        if response_content is not None: #response.choices[0].message.content
            print(colored("AI Response Content:", "green"), response.choices[0].message.content)
            # return response.choices[0].message.content
            extracted_json = extract_json_from_markdown(response_content) #response.choices[0].message.content
            if extracted_json:
                try:
                    parsed_content = json.loads(extracted_json)
                    if "vegaSpec" in parsed_content:
                        return parsed_content  # Return structured JSON
                except json.JSONDecodeError:
                    print(colored("Failed to parse JSON from AI response.", "red"))
        
            #NEW
            if requested_statistic:
                return {"statistics": response_content.strip()}
            else:
                return {"statistics": response_content.strip()}
        
        # If no tool calls are needed, break out of the loop
        if response.choices[0].message.tool_calls is None:
            print(colored("No tool calls needed, breaking loop.", "yellow"))
            break

        # If tool calls are present, process them
        messages.append(response.choices[0].message)  # Add the response with tool calls to the messages
        for tool_call in response.choices[0].message.tool_calls:
            print(colored(f"Calling tool: {tool_call.function.name} with arguments: {tool_call.function.arguments}", "cyan"))
            
            # Load arguments and call the corresponding tool function
            arguments = json.loads(tool_call.function.arguments)
            print(colored("Arguments being passed to the tool:", "blue"), arguments)
            
            if tool_call.function.name == "CalculateStatistics":
                arguments["data"] = csv_full
                
                print(colored("Calc Stats Called.", "yellow"))
            tool_function = tool_map.get(tool_call.function.name) #tool_map[tool_call.function.name]
            if not tool_function:
                print(colored(f"Tool function '{tool_call.function.name}' not found.", "red"))
                continue
            
            result = tool_function(**arguments)

            # NEW
            if isinstance(result, dict) and "vegaSpec" in result:
                    return result
            
            #if isinstance(result, dict) and "mean" in result and "median" in result and "range" in result:
            #        return {"statistics": result}
           
                
            # Create a result message with the tool's output
            result_content = json.dumps({"result": result}) #**arguments, 
            print(colored(result_content, "yellow"))
            function_call_result_message = {
                "role": "tool",
                "content": result_content,
                "tool_call_id": tool_call.id,
            }
            print(colored("Tool call result:", "magenta"), result_content)  # Print result in magenta
            
            
            messages.append(function_call_result_message)
    
    # Final check if max iterations are reached without completing the task
    if i == max_iterations and response.choices[0].message.tool_calls is not None:
        print(colored("Max iterations reached without final response", "red"))
        return "The tool agent could not complete the task in the given time. Please try again."
    
    # New Attempt
    try:
        result_content = json.loads(response.choices[0].message.content)
        print(result_content)
        return result_content  # This should include "vegaSpec"
    except json.JSONDecodeError:
        print(colored("Failed to parse JSON from AI response.", "red"))
        return {"error": "Failed to generate a valid response."}
    # return response.choices[0].message.content




@app.route('/api/openai', methods=['POST'])
def process_message():
    data = request.get_json()
    user_message = data.get("user_message")
    csv_info = data.get("csv_info")
    print(user_message)
    print(csv_info)
    csv_full = data.get("csv_full")
    print("+*+*+*+*+*+*+*+*+*+*+*+*+*+*+*+*+*+*+*+*+*++++++============")
    #print(csv_full)
    system_prompt = """
    You are a data assistant that can create Vega-Lite specifications and perform data analysis.
    You will be given both a user message with instructions and a sample of the dataset.
    Use GenerateVegaSpec to generate the vega-lite specification if the user asks for a chart,
    and use CalculateStatistics to calculate statistics such as median, average, range, etc if the user asks for an analysis, for example "What is the average worldwide gross for the movies?".
    If the user wants both an analysis and a chart, call both functions. For example, if the user says: 'Provide a summary of miles per gallon (mpg) values for all cars, and visualize mpg as a histogram' then you should generate the chart and provide the summary statistics.
    If the user says something irrelevant to data analysis, tell them to keep their questions relevant to data analysis.
    
    In vega lite a scatter plot has a chart_type of 'point'. A histogram has a chart_type of 'bar', and a y_field of count, and an is_histogram of 1.
    if the user does not want a histogram then is_histogram = 0.
    a 'bar chart' is not a histogram, they are not the same thing.
    
    For the data field of Calculate Statistics, use the variable 'csv_full', which will input the full data set.
    
    The words 'average' and 'expected value' are equivalent to the word 'mean'.
    """
    
    # Construct the prompt for the LLM
    input_info = f'''
        User Message: {user_message}\n
        Dataset Info: {csv_info}
    '''
    result = query(user_message, input_info, system_prompt, tools, tool_map, csv_full=csv_full)
    print(result)
    print(jsonify({"response": result}))
    return jsonify({"response": result})
    #If the user's query is unrelated to dataset visualization, politely ask them to focus on dataset-related questions.
    # Make a request to OpenAI's API with the constructed prompt
    
if __name__ == '__main__':
    app.run(debug=True, port=5000)