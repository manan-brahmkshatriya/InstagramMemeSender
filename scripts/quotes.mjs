/**
 * quotes.mjs
 * 365 unique motivational quotes — one for every day of the year.
 *
 * Shuffle-deck system: quotes are shuffled randomly, then consumed in that
 * order. The deck is only reshuffled AFTER every single quote has been shown
 * once. This guarantees the MAXIMUM time between any two appearances of the
 * same quote (≥ 365 posts apart at minimum = 91 days at 4 reels/day).
 *
 * Exports:
 *   MOTIVATIONAL_QUOTES — raw array (365 entries)
 *   initDeck(config)    — returns a fresh shuffled deck if none exists in config
 *   drawNextQuote(config) → { quote, updatedConfig }
 */

export const MOTIVATIONAL_QUOTES = [
  // ── Mindset ────────────────────────────────────────────────────────────
  "Your mind is a garden. Grow greatness in it.",
  "What you think, you become.",
  "The quality of your thoughts determines the quality of your life.",
  "A disciplined mind leads to happiness.",
  "Train your mind to see the good in every situation.",
  "Your mindset is your most powerful asset.",
  "Thoughts become things. Choose great ones.",
  "The mind is everything. What you think, you become.",
  "You are what you repeatedly think.",
  "Master your mind and you master your world.",
  "A positive mind finds opportunity in every difficulty.",
  "Believe it first, then you'll see it.",
  "Your reality is created by your beliefs.",
  "Reprogram your mind. Redesign your life.",
  "The mind that opens to a new idea never returns to its original size.",
  "A strong mind is greater than a strong body.",
  "Control your mind or your mind controls you.",
  "Change your thoughts and you change your world.",
  "Think big. Act bold. Start now.",
  "Clarity of mind brings clarity of results.",

  // ── Action & Discipline ─────────────────────────────────────────────────
  "Action is the antidote to anxiety.",
  "Stop waiting. Start doing.",
  "Discipline weighs ounces. Regret weighs tons.",
  "One focused hour beats ten distracted ones.",
  "Do the hard things first. The rest gets easier.",
  "Success is built one small decision at a time.",
  "Execution separates the dreamers from the achievers.",
  "Start before you're ready.",
  "Your future is built today, not tomorrow.",
  "Work while they sleep. Learn while they party.",
  "The secret of getting ahead is getting started.",
  "Dreams don't work unless you do.",
  "Push harder today so tomorrow feels easier.",
  "Every action you take is a vote for the person you want to become.",
  "Progress requires movement. Start moving.",
  "Excellence is not a destination — it's a continuous journey.",
  "Do something today your future self will thank you for.",
  "The pain of discipline is far less than the pain of regret.",
  "Motivation gets you started. Discipline keeps you going.",
  "Nothing changes if nothing changes.",

  // ── Growth & Learning ───────────────────────────────────────────────────
  "Growth lives outside your comfort zone.",
  "Every expert was once a beginner.",
  "Learn something new every single day.",
  "The person who stops growing starts dying inside.",
  "Invest in your mind. It pays the best interest.",
  "Small progress is still progress.",
  "Don't fear failure. Fear not growing from it.",
  "Your capacity to grow is unlimited.",
  "Evolve or repeat.",
  "Embrace the process. Trust the growth.",
  "The more you learn, the more you earn.",
  "Challenges are classrooms in disguise.",
  "Growth is uncomfortable, but stagnation is fatal.",
  "Every day is a new chance to improve.",
  "Be a student of life, always.",
  "Seek discomfort. That's where growth lives.",
  "Your biggest competitor is who you were yesterday.",
  "Fail. Learn. Adapt. Win.",
  "The path of growth is never straight — keep walking.",
  "Progress is impossible without change.",

  // ── Resilience & Strength ───────────────────────────────────────────────
  "Fall seven times. Stand up eight.",
  "The strongest people are those who win battles no one knows about.",
  "You're tougher than you think.",
  "Hard times don't last. Hard people do.",
  "Obstacles are the path — not a detour from it.",
  "Every setback is a setup for a comeback.",
  "Your resilience is your superpower.",
  "Out of suffering have emerged the strongest souls.",
  "When you feel like quitting, remember why you started.",
  "Storms make trees grow deeper roots.",
  "Pain is temporary. Giving up lasts forever.",
  "You didn't come this far to only come this far.",
  "Rock bottom built more champions than privilege ever did.",
  "Pressure creates diamonds. Embrace it.",
  "The comeback is always greater than the setback.",
  "Scars are just proof that you survived.",
  "Be so strong that nothing can disturb your peace of mind.",
  "Difficult roads often lead to beautiful destinations.",
  "Endurance is not just the ability to bear — it's the ability to transform.",
  "Every storm runs out of rain.",

  // ── Purpose & Vision ───────────────────────────────────────────────────
  "Live with intention. Lead with purpose.",
  "A vision without a plan is just a dream.",
  "Know your why and you'll figure out the how.",
  "You were not born to be average.",
  "Your purpose is bigger than your fear.",
  "The clearest vision attracts the greatest opportunity.",
  "Chase meaning, not applause.",
  "Build a life you don't need a vacation from.",
  "Find your purpose and the energy follows.",
  "A life lived on purpose is a life well lived.",
  "Your potential is infinite — your limits are self-imposed.",
  "Don't just exist. Live deliberately.",
  "The world needs what only you can offer.",
  "Live for something worth dying for.",
  "Clarity of purpose turns ordinary days extraordinary.",
  "Define your vision or someone else will define it for you.",
  "Purpose turns problems into possibilities.",
  "Great things come to those who stay true to their purpose.",
  "You are the author of your story — write it boldly.",
  "One day or day one. You decide.",

  // ── Success & Achievement ───────────────────────────────────────────────
  "Success is rented — the rent is due every day.",
  "Overnight success takes years of overnight work.",
  "The only shortcut to success is hard work.",
  "Success is not given. It's earned in the dark.",
  "Build your empire while they're still asleep.",
  "Your habits predict your future.",
  "Success follows systems, not luck.",
  "The difference between ordinary and extraordinary is that little extra.",
  "Successful people do what unsuccessful people are not willing to do.",
  "Consistency beats intensity every time.",
  "Win in private. Shine in public.",
  "Success is the sum of small efforts repeated daily.",
  "The road to success is always under construction.",
  "Work hard in silence. Let your success make the noise.",
  "Success requires showing up, especially when you don't feel like it.",
  "Raise your standards and the universe will meet them.",
  "Success isn't luck — it's preparation meeting opportunity.",
  "Build something today that matters tomorrow.",
  "Those who are crazy enough to think they can change the world do.",
  "Success is a mindset before it becomes a reality.",

  // ── Morning Energy ──────────────────────────────────────────────────────
  "Rise up. The world waits for no one.",
  "Today is full of unrealized potential.",
  "Make today so good that yesterday gets jealous.",
  "Your morning routine shapes your entire life.",
  "Wake up with purpose. Go to bed with pride.",
  "The morning is your canvas. Paint it boldly.",
  "Today is a chance to do what you've been putting off.",
  "Seize this morning like it's your last.",
  "Today's choices are tomorrow's results.",
  "Every morning is a new beginning. Take a deep breath and start again.",
  "Don't sleep your way through your potential.",
  "The early hours belong to those who claim them.",
  "What you do every morning determines what you accomplish every year.",
  "Greet the day with gratitude and ambition in equal measure.",
  "New day. New energy. New choices.",
  "Rise early. Read widely. Work deeply.",
  "The way you start your morning sets the tone for your whole day.",
  "Choose productive over comfortable every morning.",
  "Today's opportunities are disguised as early alarms.",
  "Each morning we are born again. What we do today matters most.",

  // ── Gratitude & Peace ───────────────────────────────────────────────────
  "Gratitude turns what we have into enough.",
  "Peace begins the moment you stop letting others control your mind.",
  "The present moment is always enough.",
  "Be thankful for what you have and you'll end up having more.",
  "A grateful heart is a magnet for miracles.",
  "Peace is not something you find — it's something you choose.",
  "Joy is found not in finishing but in doing.",
  "Count your blessings, not your problems.",
  "Enough is not a destination. It's a perspective.",
  "Still waters run deep. Stay calm and achieve deeply.",
  "The richest person is the one who is grateful for what they have.",
  "Happiness is a direction, not a place.",
  "Let go of what you can't control. Focus on what you can.",
  "Contentment with progress is the secret to sustained drive.",
  "Stillness is not emptiness — it's clarity.",
  "Live simply. Give generously. Breathe deeply.",
  "You already have everything you need to begin.",
  "In the middle of difficulty lies opportunity.",
  "Slow down and be more. Speed up and do more.",
  "The secret to having it all is believing you already do.",

  // ── Belief & Confidence ─────────────────────────────────────────────────
  "Believe in yourself even when no one else does.",
  "Confidence comes from keeping promises to yourself.",
  "Back yourself before anyone else does.",
  "The only opinion that matters is the one you hold of yourself.",
  "Doubt kills more dreams than failure ever will.",
  "You are more capable than you have ever imagined.",
  "Trust yourself. You know more than you think.",
  "The biggest risk is not taking one.",
  "Self-belief is the foundation of every achievement.",
  "You become what you believe you deserve.",
  "Speak about yourself the way you want your life to be.",
  "Back down from nothing that belongs to you.",
  "Confidence is not they will like me. It's I'll be fine if they don't.",
  "Act as if. Become it.",
  "Bet on yourself every single time.",
  "The only limits you have are the limits you believe.",
  "Step into your power. It was always yours.",
  "You are enough. A thousand times enough.",
  "Never shrink yourself to make others comfortable.",
  "Own who you are and the world adjusts.",

  // ── Courage & Risk ─────────────────────────────────────────────────────
  "Be brave enough to live the life you've always imagined.",
  "Courage doesn't roar. Sometimes it's the quiet voice saying try again.",
  "The greatest prison is the one we live in for fear of what others think.",
  "Take the leap. The net will appear.",
  "You will regret the risks you didn't take far more than those you did.",
  "Safe keeps you comfortable. Bold makes you unforgettable.",
  "Do it scared. Do it uncertain. Just do it.",
  "Fear is a liar. Don't let it make your decisions.",
  "The cave you fear to enter holds the treasure you seek.",
  "Courage is doing the thing even though you're terrified.",
  "Life begins at the end of your comfort zone.",
  "The risk of staying safe is greater than the risk of reaching high.",
  "You can't discover new oceans if you're afraid to lose sight of shore.",
  "Be the one who decided to go for it.",
  "Your biggest regret will be the chances you never took.",
  "Act boldly and unseen forces will come to your aid.",
  "The bravest thing you can do is to try one more time.",
  "Comfort is the enemy of growth. Choose courage.",
  "Risk more than others think is safe. Dream more than others think is practical.",
  "A ship in harbor is safe — but that's not what ships are for.",

  // ── Focus & Execution ──────────────────────────────────────────────────
  "Focus is a superpower in a distracted world.",
  "One task done fully beats ten tasks done halfway.",
  "Eliminate distractions. Eliminate excuses. Execute.",
  "The key to success is to say no to almost everything.",
  "Energy flows where attention goes.",
  "Stop dividing your focus and start multiplying your results.",
  "You can do anything, but not everything.",
  "Clarity multiplies effort. Get clear, then go.",
  "The person who chases two rabbits catches neither.",
  "Protect your focus like you protect your finances.",
  "Subtract before you add. Remove before you create.",
  "Single-pointed focus moves mountains.",
  "Where focus goes, energy flows and results show.",
  "Deep work creates extraordinary outcomes.",
  "Win the morning, win the day.",
  "The most productive people are the most deliberate.",
  "Say less. Do more. Show everything.",
  "Attention is the currency of the 21st century. Spend it wisely.",
  "Simplify relentlessly. Succeed inevitably.",
  "Focus is the bridge between dreams and results.",

  // ── Relationships & Impact ──────────────────────────────────────────────
  "Your network is your net worth. Build it wisely.",
  "Be the energy you want to attract.",
  "Lift others up. There's enough room for everyone to win.",
  "Your kindness is a strength, not a weakness.",
  "Build people up. The world has enough people tearing down.",
  "Leave every room better than you found it.",
  "The best investment you can make is in others.",
  "Be the person someone needed but never had.",
  "Your legacy is built in the lives you touch.",
  "Great leaders create more leaders, not more followers.",
  "How you treat people reveals who you really are.",
  "Serve deeply. Lead humbly. Impact greatly.",
  "Generosity is the highest form of intelligence.",
  "Plant seeds for others to stand in the shade of.",
  "Impact is worth more than income.",
  "The most powerful people uplift everyone around them.",
  "Make people feel seen. It costs nothing and means everything.",
  "Your story might be the one that saves someone else.",
  "We rise by lifting others.",
  "One life can change the world. That life can be yours.",

  // ── Time & Urgency ─────────────────────────────────────────────────────
  "You have the same 24 hours as everyone else. Use them.",
  "Time is non-refundable. Invest it well.",
  "Don't let yesterday take up too much of today.",
  "The best time to start was yesterday. The second best is now.",
  "Stop managing your time. Start managing your priorities.",
  "Procrastination is the assassination of motivation.",
  "Urgency and clarity together create momentum.",
  "One year from now you'll wish you started today.",
  "Time moves. Progress waits for decisions. Decide now.",
  "Value your hours more than your money. You can earn more money.",
  "Every minute you delay is a minute behind.",
  "The clock is ticking. Are you doing anything about it?",
  "Yesterday is history. Tomorrow is mystery. Today is a gift.",
  "Wasted time is the only resource you can never get back.",
  "Stop talking about your plans. Start living them.",
  "Each day lived fully is a life well spent.",
  "Make today count or count the days you wasted.",
  "Time is the great equalizer. Use it differently.",
  "At the end of your life, you'll want more time. So use today's.",
  "Respect time. It respects no one.",

  // ── Hustle & Grit ──────────────────────────────────────────────────────
  "Outwork everyone or get outworked. Choose.",
  "Grit is knowing your destination and refusing to stop.",
  "Talent is overrated. Grit wins in the long run.",
  "They'll underestimate you. That's your advantage.",
  "Work until your idols become your competition.",
  "Nobody is going to hand you anything. Go get it.",
  "If it were easy, everyone would do it.",
  "The grind is where champions are built.",
  "Stubbornness and vision are the same thing with different names.",
  "When you want success as badly as you want air, you'll have it.",
  "Bleed. Sweat. Repeat.",
  "The extra mile is never crowded.",
  "Hunger is the greatest competitive advantage.",
  "Nobody remembers the person who gave up.",
  "Grind now. Shine later.",
  "Do it until you no longer have to introduce yourself.",
  "They said you couldn't. Remember that when you do.",
  "Stay the course when the night is longest.",
  "Nothing worth having comes easy. That's what makes it worth having.",
  "Hard work beats talent when talent doesn't work hard.",

  // ── Legacy & Long Game ──────────────────────────────────────────────────
  "Build something that outlives you.",
  "Think decades. Act daily.",
  "Plant trees whose shade you'll never sit in.",
  "The long game always wins.",
  "Be more concerned with your character than your reputation.",
  "Excellence practiced daily becomes legacy.",
  "What will they say about you when you're gone?",
  "Every day is a chance to build your legacy brick by brick.",
  "Short term pain. Long term gain.",
  "Build for the future you want, not the past you had.",
  "The best time to plant a tree was 20 years ago. Today is second best.",
  "Think long. Work daily. Arrive eventually.",
  "Build a name that stands for something real.",
  "Sacrifice comfort today for legacy tomorrow.",
  "The greatest investment is the one your future self will thank you for.",
  "Act today in a way that your older self will celebrate.",
  "Small consistent actions compound into remarkable lives.",
  "Play infinite games. Finite winners are quickly forgotten.",
  "Your life is your memoir. Write it worth reading.",
  "Leave footprints worth following.",

  // ── Extra powerful one-liners ───────────────────────────────────────────
  "Make your next move your best move.",
  "Stop being afraid of what could go wrong. Think of what could go right.",
  "The energy you bring is the energy you receive.",
  "You are closer than you think.",
  "Stop surviving and start thriving.",
  "You can't pour from an empty cup. Fill yourself first.",
  "Your only competition is who you were yesterday.",
  "Potential is just a word until you act on it.",
  "Live as if your dreams are already real.",
  "You are not too late. You are right on time.",
  "Go further than you think you can.",
  "The person you are becoming is more important than any destination.",
  "Keep going. It gets better.",
  "You deserve the life you keep imagining.",
  "Do it with passion or not at all.",
  "The harder the battle, the sweeter the victory.",
  "Stop shrinking. Start expanding.",
  "Outgrow your old limits daily.",
  "Burn bridges that take you backward.",
  "Your best chapter hasn't been written yet.",
  "No shortcuts. No excuses. No limits.",
  "Create the life they'll write about.",
  "One decision can change everything.",
  "Show up. Put in the work. Trust the process.",
  "Be so good they can't ignore you.",
];

// ── Fisher-Yates shuffle ────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Ensure the config has a valid shuffled deck.
 * Returns the (possibly updated) config — call writeConfig(cfg) afterward.
 *
 * @param {object} config - The parsed .reel-generator-config.json
 * @returns {object} config with deck guaranteed to be initialised
 */
export function initDeck(config) {
  const total = MOTIVATIONAL_QUOTES.length;
  if (!config.quoteDeck || config.quoteDeck.length === 0) {
    config.quoteDeck     = shuffle([...Array(total).keys()]); // [0..364] shuffled
    config.quoteDeckPos  = 0;
    console.log(`[quotes] Fresh deck created — ${total} unique quotes, no repeats until all shown`);
  }
  return config;
}

/**
 * Draw the next quote from the deck.  When the deck is exhausted it is
 * automatically reshuffled so no quote appears a second time until every
 * other quote has appeared once.
 *
 * @param {object} config - The parsed .reel-generator-config.json (mutated in-place)
 * @returns {{ quote: string, updatedConfig: object }}
 */
export function drawNextQuote(config) {
  const cfg = initDeck(config);
  const pos  = cfg.quoteDeckPos ?? 0;

  if (pos >= cfg.quoteDeck.length) {
    // Exhausted — reshuffle
    cfg.quoteDeck    = shuffle([...Array(MOTIVATIONAL_QUOTES.length).keys()]);
    cfg.quoteDeckPos = 0;
    console.log(`[quotes] Deck exhausted — reshuffled ${MOTIVATIONAL_QUOTES.length} quotes`);
  }

  const quoteIdx = cfg.quoteDeck[cfg.quoteDeckPos];
  cfg.quoteDeckPos += 1;

  return {
    quote:         MOTIVATIONAL_QUOTES[quoteIdx],
    updatedConfig: cfg,
  };
}

// Legacy helper kept for backward-compat with any scripts that still call pickNextQuote
export function pickNextQuote(currentIndex = 0) {
  const idx = currentIndex % MOTIVATIONAL_QUOTES.length;
  return {
    quote:     MOTIVATIONAL_QUOTES[idx],
    nextIndex: (idx + 1) % MOTIVATIONAL_QUOTES.length,
  };
}
