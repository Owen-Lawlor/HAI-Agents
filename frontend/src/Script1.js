//Frontend Code

import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import vegaEmbed from 'vega-embed';
import { useDropzone } from 'react-dropzone';
import { csvParse } from 'd3-dsv';
import axios from 'axios';
import { BlocksShuffleTwo } from 'react-svg-spinners';

function ChatInterface() {
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [file, setFile] = useState(null);
    const [errorMessage, setErrorMessage] = useState(''); // State for error messages
    const [parsedData, setParsedData] = useState(null);
    const [isTableVisible, setIsTableVisible] = useState(false);
    const [loading, setLoading] = useState(false);

    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    //const handleSendMessage = () => {
    //    if (inputValue.trim() !== '') {
    //        setMessages([
    //            ...messages,
    //            { type: 'user', name: 'User', text: inputValue },
    //            { type: 'system', name: 'HAI', text: "I am a simple bot. I don't have real responses yet!" }
    //        ]);
    //        setInputValue('');
    //    }
    //};

    const handleSendMessage = async () => {
        if (inputValue.trim() !== '' && parsedData) {
            // Add the user's message to the chat first
            setLoading(true);

            setMessages([...messages, { type: 'user', name: 'User', text: inputValue }]);

            const csvInfo = `
                    The dataset contains the following columns: ${parsedData.columns.join(', ')}.
                    Here is a sample of the data:
                    ${JSON.stringify(parsedData.sampleData, null, 2)}
                `;
            

            // Call OpenAI API through the backend
            try {
                const response = await axios.post('http://localhost:5000/api/openai', {
                    user_message: inputValue,
                    csv_info: csvInfo,
                    csv_full: parsedData.fullData,
                });
                //Previously said /api/openai instead of /process-message
                //prompt: fullPrompt,
                const aiResponse = response.data.response //JSON.parse(response.data);
                console.log('AI Response:', aiResponse);
                if (aiResponse.vegaSpec) {
                    const vegaSpec = aiResponse.vegaSpec;
                    vegaSpec.data = { values: parsedData.fullData };
                    const chartId = `vega-chart-${messages.length}`;
                    setMessages(prevMessages => [
                        ...prevMessages,
                        { type: 'system', name: 'HAI', text: "Here is the chart based on your specifications.", chartId, vegaSpec }
                    ]);
                    setTimeout(() => {
                        vegaEmbed(`#${chartId}`, vegaSpec);
                    }, 100);
                } else if (aiResponse.statistics) {

                    setMessages(prevMessages => [
                        ...prevMessages,
                        { type: 'system', name: 'HAI', text: aiResponse.statistics } //`${JSON.stringify(aiResponse.statistics)}`
                    ]);
                } else if (aiResponse.vegaSpec && aiResponse.statistics) {
                    const vegaSpec = aiResponse.vegaSpec;
                    vegaSpec.data = { values: parsedData.fullData };
                    const chartId = `vega-chart-${messages.length}`;

                    setMessages(prevMessages => [
                        ...prevMessages,
                        { type: 'system', name: 'HAI', text: "Here is the chart and the summary statistics you requested.", chartId, vegaSpec },
                        { type: 'system', name: 'HAI', text: `Summary Statistics: ${JSON.stringify(aiResponse.statistics)}` }
                    ]);

                    setTimeout(() => {
                        vegaEmbed(`#${chartId}`, vegaSpec);
                    }, 100);
                } else {
                    // Fallback for unknown response
                    setMessages(prevMessages => [
                        ...prevMessages,
                        { type: 'system', name: 'HAI', text: "I'm not sure how to interpret that response." }
                    ]);
                }

                /*
                const vegaSpec = aiResponse.vegaSpec;
                const description = aiResponse.description;

                vegaSpec.data = { values: parsedData.fullData };

                const chartId = `vega-chart-${messages.length}`; //Part of original

                // Add the OpenAI response to the chat
                setMessages(prevMessages => [
                    ...prevMessages,
                    { type: 'system', name: 'HAI', text: "Here is the chart based on your specifications.", chartId, vegaSpec, description} //Description is new
                ]);

                //vegaSpec.data = { values: parsedData.fullData };

                setTimeout(() => {
                    vegaEmbed(`#${chartId}`, vegaSpec);
                }, 100);

                */
            } catch (error) {
                console.error('Error with OpenAI request:', error);
                setMessages(prevMessages => [
                    ...prevMessages,
                    { type: 'system', name: 'HAI', text: "There appears to be a problem. Please keep your query related to the provided dataset." }
                ]);
            }

            setLoading(false);

            // Clear the input field after sending
            setInputValue('');
        }
    };

    const handleClearMessages = () => {
        setMessages([]);
    };


    const handleKeyDown = (event) => {
        if (event.key === 'Enter') {
            handleSendMessage();
        }
    };

    const onDrop = (acceptedFiles, rejectedFiles) => {
        if (acceptedFiles.length > 0) {
            const uploadedFile = acceptedFiles[0];

            
            if (uploadedFile.name.endsWith('.csv')) {
                setFile(uploadedFile);
                setErrorMessage(''); 
                parseCSVFile(uploadedFile);
            } else {
                setErrorMessage('Incorrect File Type. File type must be .csv!');
                setFile(null); // Reset the file state
            }
        }

        if (rejectedFiles.length > 0) {
            setErrorMessage('Incorrect File Type. File type must be .csv!');
            console.error('File rejected:', rejectedFiles);
            setFile(null); // Reset the file state
        }
    };

    const parseCSVFile = (file) => {
        const reader = new FileReader();

        // Read the file as text
        reader.onload = (event) => {
            const csvText = event.target.result;

            // Parse the CSV text using d3-dsv's csvParse
            const parsed = csvParse(csvText);

            const columns = Object.keys(parsed[0]);
            const sampleData = parsed.slice(0, 5);

            // Save the parsed data into state
            setParsedData({
                columns: columns,
                sampleData: sampleData,
                fullData: parsed
            });

            console.log('Parsed CSV Columns:', columns);
            console.log('Sample Data:', sampleData);

        };

        // Read the file
        reader.readAsText(file);
    };

    const toggleTable = () => {
        setIsTableVisible(!isTableVisible);
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: '.csv', multiple: false, });


    return (
        <div className="font-sans w-full h-screen flex flex-col bg-white shadow-md rounded-lg overflow-hidden">
            <div className="bg-blue-600 text-white text-center p-4">
                <h1 className="text-xl font-bold">HAI Bot</h1>
            </div>


            <div {...getRootProps()} className="p-4 border-dashed border-2 border-gray-400 mt-2 bg-gray-100 text-center cursor-pointer">
                <input {...getInputProps()} />
                {isDragActive ? (
                    <p>Drop the files here...</p>
                ) : (
                    <p>Drag 'n' drop a CSV file here, or click to select one</p>
                )}
            </div>

            {errorMessage && (
                <div className="p-2 text-center text-red-500">
                    <p>{errorMessage}</p>
                </div>
            )}

            {file && (
                <div className="p-2 text-center text-green-500">
                    <p>Uploaded file: {file.name}</p>
                </div>
            )}

            {parsedData && (
                <div className="text-center mt-4">
                    <button
                        onClick={toggleTable}
                        className="bg-blue-600 text-white p-2 rounded"
                    >
                        {isTableVisible ? 'Hide Table Preview' : 'Show Table Preview'}
                    </button>
                </div>
            )}

            {isTableVisible && parsedData && (
                <div className="p-4 max-h-80 overflow-y-auto border border-gray-400 rounded-lg mt-4">
                    <h3 className="text-lg font-bold text-center">Table Preview (First 10 Entries)</h3>
                    <table className="min-w-full bg-white border-collapse">
                        <thead>
                            <tr>
                                {parsedData.columns.map((key) => (  //{Object.keys(parsedData[0]).map((key)
                                    <th key={key} className="border px-4 py-2 text-left">{key}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {parsedData.fullData.slice(0, 10).map((row, index) => (
                                <tr key={index}>
                                    {Object.values(row).map((value, idx) => (
                                        <td key={idx} className="border px-4 py-2">{value}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            

            <div className="flex-1 p-4 overflow-y-auto bg-white-600">
                <div className="flex flex-col space-y-4">
                    {messages.map((msg, index) => (
                        <React.Fragment key={index}>
                            <p className={`text-sm font-semibold mb-0 ${msg.type === 'user' ? 'text-right' : 'text-left'}`} style={{ marginBottom: '2px' }}>
                                {msg.name}
                            </p>

                            {msg.chartId && msg.vegaSpec ? (
                                <div className="p-2 rounded-lg bg-gray-300 text-black mr-auto text-left" style={{ maxWidth: '50%', wordBreak: 'break-word', marginTop: '0' }}>
                                    <div id={msg.chartId}></div> {/* Chart will be embedded here */}
                                    
                                    <p className="mt-2 text-sm text-gray-700"> 
                                        {msg.description} {/* This will render the AI-generated description */}
                                    </p>
                                </div> //Above three lines are new
                            ) : (

                                <div
                                    className={`p-2 rounded-lg ${msg.type === 'user'
                                        ? 'bg-blue-600 text-white ml-auto text-left'
                                        : 'bg-gray-300 text-black mr-auto text-left'
                                        }`}
                                    style={{
                                        maxWidth: '50%',
                                        wordBreak: 'break-word',
                                        marginTop: '0'
                                    }}
                                >
                                    {msg.text}
                                </div>
                            )}
                        </React.Fragment>
                    ))}
                    {loading && (
                        <div className="flex items-center space-x-2 mt-2">
                            <BlocksShuffleTwo width={20} height={20} color="gray" />
                            <p className="text-gray-500 text-sm">Working on it... This may take a few seconds.</p>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>
            <div className="p-4 border-t border-gray-200 bg-white">
                <div className="flex items-center">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-full p-2 border border-gray-300 rounded h-10"
                        placeholder="Type your message here..."
                    />
                <button
                    onClick={handleSendMessage}
                    className="ml-2 p-2 bg-blue-600 text-white rounded w-20 h-10"
                >
                    Send
                </button>
                <button
                    onClick={handleClearMessages} // New button for clearing messages
                    className="ml-2 p-2 bg-red-600 text-white rounded w-24 h-10"
                >
                    Clear
                </button>
                </div>
            </div>
        </div>
    );
}

export default ChatInterface;