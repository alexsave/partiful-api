(function() {
    // Create a WebSocket connection to the server
    const socket = new WebSocket('ws://localhost:3001');
  
    // Event listener for when the connection is opened
    socket.addEventListener('open', (event) => {
      console.log('WebSocket connection opened:', event);
  
      // Send a message to the server after connection is established (optional)
      socket.send(JSON.stringify({ type: 'greeting', message: 'Hello from content script!' }));
    });
  
    // Event listener for incoming messages from the WebSocket server
    socket.addEventListener('message', (event) => {
      console.log('Received message from server:', event.data);
    });
  
    // Event listener for errors in the WebSocket connection
    socket.addEventListener('error', (event) => {
      console.error('WebSocket error:', event);
    });
  
    // Event listener for when the WebSocket connection is closed
    socket.addEventListener('close', (event) => {
      console.log('WebSocket connection closed:', event);
    });
  })();
  