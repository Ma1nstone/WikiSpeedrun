const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username:     { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 20 },
  password:     { type: String, required: true },
  createdAt:    { type: Date, default: Date.now },
  friends:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  friendRequests: [{ from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, sentAt: { type: Date, default: Date.now } }],
  stats: {
    gamesPlayed: { type: Number, default: 0 },
    gamesWon:    { type: Number, default: 0 },
    totalClicks: { type: Number, default: 0 },
    bestTime:    { type: Number, default: null },
  }
});

module.exports = mongoose.model('User', userSchema);