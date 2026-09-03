const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Serve static files reliably from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Explicit fallback to index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Room State Storage
const rooms = {};

io.on('connection', (socket) => {
    let currentRoom = null;
    let userId = socket.id;

    socket.on('join-room', ({ roomId, username, isHost }) => {
        currentRoom = roomId;
        socket.join(roomId);

        // Initialize room state if new
        if (!rooms[roomId]) {
            rooms[roomId] = {
                hostId: isHost ? userId : null,
                users: {},
                chatHistory: [],
                canvasHistory: [],
                chatEnabled: true
            };
        }

        const room = rooms[roomId];

        // Ensure only one host exists if requested
        let effectiveHost = isHost;
        if (isHost && room.hostId && room.hostId !== userId) {
            effectiveHost = false; // Downgrade to student if host already exists
        } else if (isHost && !room.hostId) {
            room.hostId = userId;
        }

        // Store user state
        room.users[userId] = {
            id: userId,
            username: username || 'Anonymous',
            isHost: effectiveHost,
            isMuted: true,
            isCameraOn: false
        };

        // Notify user of role confirmation
        socket.emit('role-confirmed', { isHost: effectiveHost });

        // Send existing room history to joining user
        socket.emit('load-canvas-history', room.canvasHistory);
        socket.emit('load-chat-history', {
            history: room.chatHistory,
            enabled: room.chatEnabled
        });

        // Broadcast updated user list to everyone in room
        io.to(roomId).emit('update-participants', Object.values(room.users));
        
        // Notify other users for WebRTC peer connections
        socket.to(roomId).emit('user-connected', { userId, username });
    });

    // Handle Media Status Updates (Mute/Camera toggles)
    socket.on('update-media-status', (status) => {
        if (!currentRoom || !rooms[currentRoom] || !rooms[currentRoom].users[userId]) return;
        rooms[currentRoom].users[userId].isMuted = status.isMuted;
        rooms[currentRoom].users[userId].isCameraOn = status.isCameraOn;
        io.to(currentRoom).emit('update-participants', Object.values(rooms[currentRoom].users));
    });

    // Handle Drawing Events
    socket.on('draw-stroke', (strokeData) => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        const user = room.users[userId];

        // Only host can draw
        if (user && user.isHost) {
            room.canvasHistory.push(strokeData);
            socket.to(currentRoom).emit('draw-stroke', strokeData);
        }
    });

    // Clear Whiteboard
    socket.on('clear-canvas', () => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        const user = room.users[userId];

        if (user && user.isHost) {
            room.canvasHistory = [];
            io.to(currentRoom).emit('clear-canvas');
        }
    });

    // Handle Chat Messages
    socket.on('send-chat-message', (text) => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        const user = room.users[userId];

        if (!user) return;
        if (!room.chatEnabled && !user.isHost) return; // Block student messages if disabled

        const msgData = {
            sender: user.username,
            isHost: user.isHost,
            text: text,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        room.chatHistory.push(msgData);
        io.to(currentRoom).emit('new-chat-message', msgData);
    });

    // Handle Toggle Chat Permission
    socket.on('toggle-chat-status', (enabled) => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        const user = room.users[userId];

        if (user && user.isHost) {
            room.chatEnabled = enabled;
            io.to(currentRoom).emit('chat-status-changed', enabled);
        }
    });

    // WebRTC Signaling Events
    socket.on('webrtc-offer', ({ targetId, offer }) => {
        io.to(targetId).emit('webrtc-offer', { senderId: userId, offer });
    });

    socket.on('webrtc-answer', ({ targetId, answer }) => {
        io.to(targetId).emit('webrtc-answer', { senderId: userId, answer });
    });

    socket.on('webrtc-ice-candidate', ({ targetId, candidate }) => {
        io.to(targetId).emit('webrtc-ice-candidate', { senderId: userId, candidate });
    });

    // Handle Disconnections
    socket.on('disconnect', () => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];

        delete room.users[userId];
        if (room.hostId === userId) {
            room.hostId = null; // Reset host if host left
        }

        if (Object.keys(room.users).length === 0) {
            delete rooms[currentRoom]; // Clean up empty room
        } else {
            io.to(currentRoom).emit('update-participants', Object.values(room.users));
            io.to(currentRoom).emit('user-disconnected', userId);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
