const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));


io.on('connection', (socket) => {
    socket.on('join-room', ({ roomId, username, isHost }) => {
        if (!rooms[roomId]) {
            rooms[roomId] = {
                participants: [],
                hostId: null,
                drawHistory: [],
                chatHistory: [],
                chatEnabled: true
            };
        }

        const room = rooms[roomId];

        let assignedRoleIsHost = isHost;
        if (isHost) {
            if (room.hostId && room.hostId !== socket.id) {
                assignedRoleIsHost = false;
                socket.emit('host-denied', 'A host (teacher) is already active in this room. Joined as a Student instead.');
            } else {
                room.hostId = socket.id;
            }
        }

        const user = {
            id: socket.id,
            username: username || (assignedRoleIsHost ? 'Teacher' : 'Student'),
            isHost: assignedRoleIsHost,
            isMuted: true,
            isCameraOn: false
        };

        room.participants.push(user);
        socket.roomId = roomId;
        socket.isHost = assignedRoleIsHost;
        socket.username = user.username;

        socket.join(roomId);

        socket.emit('role-confirmed', { isHost: assignedRoleIsHost });
        io.to(roomId).emit('update-participants', room.participants);

        // Send whiteboard & chat history to joining participant
        socket.emit('load-canvas-history', room.drawHistory);
        socket.emit('load-chat-history', { history: room.chatHistory, enabled: room.chatEnabled });

        socket.on('update-media-status', (status) => {
            const currentRoom = rooms[socket.roomId];
            if (currentRoom) {
                const targetUser = currentRoom.participants.find(u => u.id === socket.id);
                if (targetUser) {
                    targetUser.isMuted = status.isMuted;
                    targetUser.isCameraOn = status.isCameraOn;
                    io.to(socket.roomId).emit('update-participants', currentRoom.participants);
                }
            }
        });

        // Chat logic
        socket.on('send-chat-message', (messageText) => {
            const currentRoom = rooms[socket.roomId];
            if (!currentRoom) return;

            // Block student messages if chat is disabled
            if (!currentRoom.chatEnabled && !socket.isHost) return;

            const msgData = {
                sender: socket.username,
                isHost: socket.isHost,
                text: messageText,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };

            currentRoom.chatHistory.push(msgData);
            io.to(socket.roomId).emit('new-chat-message', msgData);
        });

        socket.on('toggle-chat-status', (enabled) => {
            if (socket.isHost && rooms[roomId]) {
                rooms[roomId].chatEnabled = enabled;
                io.to(roomId).emit('chat-status-changed', enabled);
            }
        });

        // Whiteboard logic
        socket.on('draw-data', (data) => {
            if (socket.isHost && rooms[roomId]) {
                rooms[roomId].drawHistory.push(data);
                socket.to(roomId).emit('draw-data', data);
            }
        });

        socket.on('clear-canvas', () => {
            if (socket.isHost && rooms[roomId]) {
                rooms[roomId].drawHistory = [];
                socket.to(roomId).emit('clear-canvas');
            }
        });

        socket.on('disconnect', () => {
            if (rooms[roomId]) {
                rooms[roomId].participants = rooms[roomId].participants.filter(u => u.id !== socket.id);
                
                if (room.hostId === socket.id) {
                    room.hostId = null;
                }

                if (rooms[roomId].participants.length === 0) {
                    delete rooms[roomId];
                } else {
                    io.to(roomId).emit('update-participants', rooms[roomId].participants);
                }
            }
        });
    });
});

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
