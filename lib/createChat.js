import Chat from "../models/chat.model.js";
export async function newChat({ message, sender, receiver, type, group }) {
  try {
   
    let newChat;
    if (type === "group") {
      newChat = {
        group,
        sender,
        message,
        isGroup: true,
      };
    } else {
      newChat = {
        sender,
        receiver,
        message,
        isGroup: false,
      };
    }
     await Chat.create(newChat);
    console.log("Chat created successfully");
  } catch (error) {
    console.log(error);
    return error;
  }
}
