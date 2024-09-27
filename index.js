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
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  },
});

app.use(cookieParser());

const userMap = new Map();
const userRooms = new Map();
const rateLimit = new Map();

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
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  userMap.set(socket.user.id, socket.id);

  socket.on("joinRoom", (groupId) => {
    socket.join(groupId);
    userRooms.set(socket?.user.id, groupId);
  });

  socket.on("leaveRoom", (groupId) => {
    socket.leave(groupId);
    userRooms.delete(socket?.user.id);
  });

  socket.on("new:message", async (data) => {
    const now = Date.now();
    const userId = socket.user.id;
    if (rateLimit.has(userId) && now - rateLimit.get(userId) < 200) {
      socket.emit("error", {
        message: "You are sending messages too quickly. Please wait.",
      });
      return;
    }
    rateLimit.set(userId, now);

    try {
      const { message, receiver, isGroup, group, type, media, _id, members } =
        data;
      let reaTimeMessage;

      let dbMessage = {
        sender: socket.user.id,
        message,
        type,
        ...(isGroup ? { group } : { receiver: receiver._id }),
        isGroup: isGroup,
        createdAt: Date.now(),
      };
      if (isGroup) {
        reaTimeMessage = {
          _id,
          group,
          message,
          media,
          type,
          sender: {
            username: socket.user.username,
            _id: userId,
          },

          isGroup: true,
          createdAt: Date.now(),
        };
        socket.broadcast
          .to(userRooms.get(socket.user.id))
          .emit("new:message", reaTimeMessage);
        members.forEach((member) => {
          socket
            .to(userMap.get(member))
            .emit("new:messageAlert", reaTimeMessage);
        });
      } else {
        reaTimeMessage = {
          _id,
          sender: {
            username: socket.user.username,
            _id: userId,
          },
          receiver,
          type,
          media,
          message,
          isGroup: false,
          createdAt: new Date(Date.now()),
        };

        socket
          .to(userMap.get(receiver._id))
          .emit("new:message", reaTimeMessage);
        socket
          .to(userMap.get(receiver._id))
          .emit("new:messageAlert", reaTimeMessage);
      }

      if (type == "text") {
        await newChat(dbMessage);
      }
    } catch (error) {
      socket.emit("error", { message: "Failed to process message" });
    }
  });

  socket.on("user:typing", (data) => {
    const username = socket.user.username;
    const { receiverId, isGroup, groupId } = data;
    if (isGroup) {
      socket.broadcast
        .to(userRooms.get(socket.user.id))
        .emit("user:typing", username);
    } else {
      socket.to(userMap.get(receiverId)).emit("user:typing", username);
    }
  });

  socket.on("user:stopTyping", (data) => {
    const username = socket.user.username;
    const { receiverId, isGroup, groupId } = data;
    if (isGroup) {
      socket.broadcast
        .to(userRooms.get(socket.user.id))
        .emit("user:stopTyping", username);
    } else {
      socket.to(userMap.get(receiverId)).emit("user:stopTyping", username);
    }
  });

  socket.on("friend:request", (data) => {
    const { username, id } = socket.user;
    const { receiverId } = data;
    socket
      .to(userMap.get(receiverId))
      .emit("friend:request", { username, _id: id });
  });

  socket.on("friend:accept", (data) => {
    const { username, id } = socket.user;
    const { receiverId } = data;
    const receiverSocketId = userMap.get(receiverId);
    const senderSocketId = userMap.get(id);
    if (receiverSocketId) {
      socket.to(receiverSocketId).emit("friend:accept", { username, _id: id });
      io.to(receiverSocketId).emit("refresh:chat");
    }
    if (senderSocketId) {
      io.to(senderSocketId).emit("refresh:chat");
    }
  });
  socket.on("refresh:chat", (data) => {
    const { id } = socket.user;
    const { receiverId } = data;
    const receiverSocketId = userMap.get(receiverId);
    const senderSocketId = userMap.get(id);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("refresh:chat");
    }
    if (senderSocketId) {
      io.to(senderSocketId).emit("refresh:chat");
    }
  });
  socket.on("group:alert", (data) => {
    const { members, groupName, type } = data;
    if (type === "updateInfo") {
      members.forEach((member) => {
        socket
          .to(userMap.get(member._id))
          .emit(
            "group:alert",
            `${socket.user.username} updated ${groupName} group info.`
          );
      });
    } else if (type === "addNewMembers") {
      members.forEach((member) => {
        socket
          .to(userMap.get(member._id))
          .emit(
            "group:alert",
            `${socket.user.username} added ${groupName} group member. (New Member: ${member.username})`
          );
      });
    } else if (type === "removeMember") {
      members.forEach((member) => {
        socket
          .to(userMap.get(member._id))
          .emit(
            "group:alert",
            `${socket.user.username} removed ${member.username} from ${groupName} group`
          );

      });
    } else if (type === "deleteGroup") {
      members.forEach((member) => {
        socket
          .to(userMap.get(member._id))
          .emit(
            "group:alert",
            `${socket.user.username} deleted ${groupName} group.`
          );
            io.to(member._id).emit("refresh:chat");
      });
    } else if (type === "leaveGroup") {
      members.forEach((member) => {
        socket
          .to(userMap.get(member._id))
          .emit(
            "group:alert",
            `${socket.user.username} left the  ${groupName} group.`
          );
          io.to(member._id).emit("refresh:chat");
      });
    } else if (type === "changeRole") {
      members.forEach((member) => {
        socket
          .to(userMap.get(member._id))
          .emit(
            "group:alert",
            `${socket.user.username} promoted ${member.username} to admin in ${groupName} group`
          );
      });
    } else if (type === "removeAdmin") {
      members.forEach((member) => {
        socket
          .to(userMap.get(member._id))
          .emit(
            "group:alert",
            `${socket.user.username} removed admin privileges from ${member.username} in ${groupName} group`
          );
      });
    } else if (type === "create") {
      members.forEach((member) => {
        socket
          .to(userMap.get(member._id))
          .emit(
            "group:alert",
            `${socket.user.username} created ${groupName} group and added you to the group.`
          );
          io.to(member._id).emit("refresh:chat");
      });
    }
  });

  socket.on("call:request", (data) => {
    const { id,type } = data;
    const me = socket.user.id;
    const username = socket.user.username;
    const recipientSocketId = userMap.get(id);
    socket.to(recipientSocketId).emit("call:request", { id: me, username,type });
  });
socket.on("call:request:accept", (data) => {
  const { id } = data;
  const me = socket.user.id;
  const username = socket.user.username;
  const recipientSocketId = userMap.get(id);
  socket.to(recipientSocketId).emit("call:request:accept", { id: me, username });
})


  socket.on("decline:call", (data) => {
    const { id } = data;
    const username = socket.user.username;
    const recipientSocketId = userMap.get(id);
    socket.to(recipientSocketId).emit("decline:call", { username });
  });

  socket.on("call:user", (data) => {
    const { id, offer } = data;
    const recipientSocketId = userMap.get(id);
    socket
      .to(recipientSocketId)
      .emit("call:user", { offer: offer, id: socket.user.id });
  });

  socket.on("call:accepted", (data) => {
    const { id, answer } = data;
    const recipientSocketId = userMap.get(id);
    socket.to(recipientSocketId).emit("call:accepted", { answer });
  });
  socket.on("ice:candidate", (data) => {
    const { id, candidate } = data;

    const recipientSocketId = userMap.get(id);
    socket.to(recipientSocketId).emit("ice:candidate", candidate);
  });

  socket.on("disconnect", () => {
    userMap.delete(socket.user.id);
    userRooms.delete(socket.user.id);
  });
});

httpServer.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});
