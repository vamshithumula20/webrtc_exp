const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store active chat rooms
const chatRooms = new Map();

wss.on('connection', (ws) => {
    let currentRoom = null;
    let currentUser = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        console.log('Server received:', data);

        if (data.type === 'join') {
            // Handle joining a room
            currentRoom = data.roomId;
            currentUser = data.username;
            
            if (!chatRooms.has(currentRoom)) {
                chatRooms.set(currentRoom, new Set());
            }
            
            chatRooms.get(currentRoom).add(ws);
            
            // Notify others in the room
            broadcastToRoom(currentRoom, {
                type: 'system',
                message: `${currentUser} has joined the chat`
            }, ws);

            // Notify others about the new user for video call
            broadcastToRoom(currentRoom, {
                type: 'user-joined',
                sender: currentUser
            }, ws);
        } 
        else if (data.type === 'message' && currentRoom) {
            // Broadcast message to all users in the room
            broadcastToRoom(currentRoom, {
                type: 'message',
                message: data.message,
                sender: data.sender
            });
        }
        // Handle WebRTC signaling
        else if (['video-offer', 'video-answer', 'ice-candidate', 'call-request'].includes(data.type) && currentRoom) {
            // Forward WebRTC signaling messages to other users in the room
            broadcastToRoom(currentRoom, {
                ...data,
                sender: currentUser
            }, ws);
        }
    });

    ws.on('close', () => {
        if (currentRoom && chatRooms.has(currentRoom)) {
            chatRooms.get(currentRoom).delete(ws);
            
            // If room is empty, remove it
            if (chatRooms.get(currentRoom).size === 0) {
                chatRooms.delete(currentRoom);
            } else {
                // Notify others that user has left
                broadcastToRoom(currentRoom, {
                    type: 'system',
                    message: `${currentUser} has left the chat`
                });
            }
        }
    });
});

function broadcastToRoom(roomId, message, excludeWs = null) {
    if (chatRooms.has(roomId)) {
        console.log(`Broadcasting to room ${roomId}:`, message);
        chatRooms.get(roomId).forEach((client) => {
            if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 