import express from "express";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import connectDB from "./config/databaseConnection.js";
import cookieParser from "cookie-parser";
import { parse } from "cookie";
import jwt from "jsonwebtoken";
import cors from "cors";
import { newChat } from "./lib/createChat.js";

dotenv.config({ path: "./config.env" });
connectDB();

const app = express();
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(cookieParser());

// Track connected users and their rooms
const userMap = new Map();
const userRooms = new Map();
const rateLimit = new Map(); // Track message rates

io.use((socket, next) => {
  const cookie = socket.handshake.headers.cookie;
  const parsedCookies = cookie ? parse(cookie) : {};
  const token = parsedCookies.token;

  try {
    const decoded = jwt.verify(token, process.env.JWT_PRIVATE_KEY);
    socket.user = {
      id: decoded.id,
      username: decoded.username,
    };
    next();
  } catch (error) {
    console.log(error.message);
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  userMap.set(socket.user.id, {
    socketId: socket.id,
    username: socket.user.username,
  });


  socket.on("joinRoom", (groupId) => {
    socket.join(groupId);
    userRooms.set(socket.user.id, groupId);
    console.log("joined room", groupId);
  });

  socket.on("leaveRoom", (groupId) => {
    socket.leave(groupId);
    userRooms.delete(socket.user.id);
  });

  socket.on("newMessage", async (data) => {
    console.log(data)
    const now = Date.now();
    const userId = socket.user.id;
    if (rateLimit.has(userId) && now - rateLimit.get(userId) < 5000) {
      socket.emit("error", {
        message: "You are sending messages too quickly. Please wait.",
      });
      return;
    }
    rateLimit.set(userId, now);

    try {
      const { receiverId, message, isGroup, groupId } = data;
      let reaTimeMessage;
      
      let dbMessage = {
        sender: socket.user.id,
        message,
        ...(isGroup ? { group: groupId } : { receiver: receiverId }),
        isGroup: false,
        createdAt: Date.now(),
      };
        if (isGroup) {
          console.log(isGroup)
          reaTimeMessage = {
            sender: socket.user.username,
            message,
            isGroup: true,
            createdAt: Date.now(),
          };
          io.to(userRooms.get(socket.user.id)).emit("receiveMessage", reaTimeMessage);
        } else {
          reaTimeMessage = {
            sender: {
              username: socket.user.username,
              _id: socket.user.id,
            },
            receiver: {
              username: userMap.get(receiverId).username,
              _id: receiverId,
            },
            message,
            isGroup: false,
            createdAt: new Date(Date.now()),
          };

          socket
            .to(userMap.get(receiverId).socketId)
            .emit("receiveMessage", reaTimeMessage);
        }
      
      // await newChat(dbMessage);
    } catch (error) {
      console.error("Error processing message:", error.message);
      socket.emit("error", { message: "Failed to process message" });
    }
  });

  socket.on("disconnect", () => {
    userMap.delete(socket.user.id);
    userRooms.delete(socket.user.id);
    console.log(`User ${socket.user.username} disconnected`);
  });
});

httpServer.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});
