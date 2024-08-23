import mongoose from "mongoose";

const mediaSchema = new mongoose.Schema({
  group: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Group",
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  isGroup: {
    type: Boolean,
    default: false,
  },
  isDeleted: {
    type: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  source: {
    url: {
      type: String,
      required: true,
    },
    public_id: {
      type: String,
      required: true,
    },
  },
  type: {
    type: String,
    enum: ["image", "video", "audio", "document"],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Media = mongoose.models.Media || mongoose.model("Media", mediaSchema);

export default Media;
