/**
 * quotes.mjs
 * Pool of unique motivational quotes for reel overlays.
 * Each quote is short enough to display as 2-3 lines on a portrait video.
 */

export const MOTIVATIONAL_QUOTES = [
  // Mindset & growth
  "Your only limit is your mind.",
  "Fall seven times, stand up eight.",
  "Be the energy you want to attract.",
  "Discipline is the bridge between goals and achievement.",
  "You don't have to be great to start, but you have to start to be great.",
  "The secret of getting ahead is getting started.",
  "Push yourself, because no one else is going to do it for you.",
  "Great things never come from comfort zones.",
  "Dream it. Wish it. Do it.",
  "Success doesn't just find you. You have to go out and get it.",

  // Resilience & courage
  "The harder you work for something, the greater you'll feel when you achieve it.",
  "Don't stop when you're tired. Stop when you're done.",
  "Wake up with determination. Go to bed with satisfaction.",
  "Little things make big days.",
  "It's going to be hard, but hard is not impossible.",
  "Don't wait for opportunity. Create it.",
  "Sometimes we're tested not to show our weaknesses, but to discover our strengths.",
  "The key to success is to focus on goals, not obstacles.",
  "Believe you can and you're halfway there.",
  "Do something today that your future self will thank you for.",

  // Purpose & action
  "Work hard in silence. Let your success make the noise.",
  "Stop wishing. Start doing.",
  "You are enough. A thousand times enough.",
  "One day or day one — you decide.",
  "Be stronger than your strongest excuse.",
  "Your life is your message to the world. Make it inspiring.",
  "The best time to plant a tree was 20 years ago. The second best time is now.",
  "Success is the sum of small efforts repeated day in and day out.",
  "Every day is a chance to be better than yesterday.",
  "The only way to do great work is to love what you do.",

  // Morning & daily inspiration
  "Rise up. Start fresh. See the bright opportunity in each new day.",
  "Today is your opportunity to build the tomorrow you want.",
  "You are one decision away from a totally different life.",
  "Starve your distractions. Feed your focus.",
  "The difference between ordinary and extraordinary is that little 'extra'.",
];

/**
 * Pick the next quote using a rotating index stored in config.
 * @param {number} currentIndex - current quote index from config
 * @returns {{ quote: string, nextIndex: number }}
 */
export function pickNextQuote(currentIndex = 0) {
  const idx = currentIndex % MOTIVATIONAL_QUOTES.length;
  return {
    quote:     MOTIVATIONAL_QUOTES[idx],
    nextIndex: (idx + 1) % MOTIVATIONAL_QUOTES.length,
  };
}
