import Chat from "../models/chat.model.js";
export async function newChat(newChat) {
  try {
    await Chat.create(newChat);
    
   
  } catch (error) {
    console.log(error);
    return error;
  }
}
