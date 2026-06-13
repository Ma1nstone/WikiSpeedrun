const mongoose = require('mongoose');

const gameRecordSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  username:    String,
  startArticle: String,
  targetArticle: String,
  clicks:      Number,
  timeTaken:   Number,
  won:         Boolean,
  path:        [String],
  playedAt:    { type: Date, default: Date.now }
});

module.exports = mongoose.model('GameRecord', gameRecordSchema);