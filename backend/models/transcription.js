// models/Transcription.js
const mongoose = require('mongoose');

const transcriptionSchema = new mongoose.Schema({
  transcript: String,
  speakerSegments: [
    {
      speaker: String,
      startTime: String,
      endTime: String,
      content: String,
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.models.Transcription || mongoose.model('Transcription', transcriptionSchema);
