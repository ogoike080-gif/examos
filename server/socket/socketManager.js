const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

const connectedUsers = new Map();  // userId -> socket
const examRooms = new Map();       // examId -> Set of socketIds

function initSocket(io) {

  // Auth middleware for sockets
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const { id: userId, role } = socket.user;
    connectedUsers.set(userId, socket.id);

    console.log(`✅ Socket connected: ${socket.user.email} [${role}] - ${socket.id}`);

    // ── CANDIDATE EVENTS ──

    // Join exam room
    socket.on('join-exam', ({ exam_id, session_id }) => {
      const room = `exam-${exam_id}`;
      socket.join(room);

      if (!examRooms.has(exam_id)) examRooms.set(exam_id, new Set());
      examRooms.get(exam_id).add(socket.id);

      // Notify proctors
      socket.to(`proctor-${exam_id}`).emit('candidate-joined', {
        user: socket.user,
        session_id,
        timestamp: new Date().toISOString(),
      });

      console.log(`📋 ${socket.user.email} joined exam room: ${room}`);
    });

    // Real-time answer save notification
    socket.on('answer-saved', ({ session_id, question_id, exam_id }) => {
      socket.to(`proctor-${exam_id}`).emit('candidate-activity', {
        type: 'answer_saved',
        candidate_id: userId,
        session_id,
        question_id,
        timestamp: new Date().toISOString(),
      });
    });

    // Proctoring events from client-side AI
    socket.on('proctor-event', async ({ session_id, exam_id, event_type, metadata }) => {
      const eventData = {
        session_id,
        candidate: socket.user,
        event_type,
        metadata,
        timestamp: new Date().toISOString(),
      };

      // Broadcast to all proctors watching this exam
      io.to(`proctor-${exam_id}`).emit('live-violation', eventData);

      // Broadcast to admin room
      io.to('admin-room').emit('live-violation', eventData);
    });

    // Heartbeat from candidate (connectivity check)
    socket.on('heartbeat', ({ session_id, exam_id, time_remaining }) => {
      socket.to(`proctor-${exam_id}`).emit('candidate-heartbeat', {
        candidate_id: userId,
        session_id,
        time_remaining,
        timestamp: new Date().toISOString(),
      });
    });

    // Candidate submits exam
    socket.on('exam-submitted', ({ session_id, exam_id }) => {
      io.to(`proctor-${exam_id}`).emit('candidate-submitted', {
        candidate: socket.user,
        session_id,
        timestamp: new Date().toISOString(),
      });
    });

    // ── PROCTOR/ADMIN EVENTS ──

    // Proctor joins monitoring room
    socket.on('join-proctor', ({ exam_id }) => {
      const room = `proctor-${exam_id}`;
      socket.join(room);
      socket.join('admin-room');
      console.log(`🔍 Proctor ${socket.user.email} joined: ${room}`);
    });

    // Proctor sends action to candidate
    socket.on('proctor-action', ({ candidate_id, action, message, exam_id }) => {
      const candidateSocket = connectedUsers.get(candidate_id);
      if (candidateSocket) {
        io.to(candidateSocket).emit('proctor-message', {
          action,
          message,
          from: socket.user.full_name,
          timestamp: new Date().toISOString(),
        });
      }

      // Confirm to proctor
      socket.emit('action-sent', {
        candidate_id,
        action,
        delivered: !!candidateSocket,
      });
    });

    // Admin broadcasts to all candidates in an exam
    socket.on('broadcast-exam', ({ exam_id, message, action }) => {
      if (!['superadmin', 'admin'].includes(role)) return;
      io.to(`exam-${exam_id}`).emit('exam-broadcast', {
        message,
        action,
        from: 'ExamOS Control',
        timestamp: new Date().toISOString(),
      });
    });

    // Remote pause/resume exam
    socket.on('control-exam', ({ exam_id, command }) => {
      if (!['superadmin', 'admin', 'proctor'].includes(role)) return;
      io.to(`exam-${exam_id}`).emit('exam-control', {
        command, // 'pause' | 'resume' | 'extend-time' | 'terminate'
        timestamp: new Date().toISOString(),
      });
    });

    // ── DISCONNECT ──
    socket.on('disconnect', (reason) => {
      connectedUsers.delete(userId);
      console.log(`❌ Socket disconnected: ${socket.user.email} - ${reason}`);

      // Notify proctors of disconnection
      examRooms.forEach((sockets, examId) => {
        if (sockets.has(socket.id)) {
          sockets.delete(socket.id);
          io.to(`proctor-${examId}`).emit('candidate-disconnected', {
            candidate: socket.user,
            reason,
            timestamp: new Date().toISOString(),
          });
        }
      });
    });
  });

  console.log('📡 Socket.io initialized');
}

function getConnectedUsers() {
  return connectedUsers;
}

module.exports = { initSocket, getConnectedUsers };
