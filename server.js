const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
 
const app = express();
const PORT = 3001;
const JWT_SECRET = 'reviewguard_secret_key_2026';
 
app.use(cors());
app.use(express.json());
 
// ─── In-Memory Database ───────────────────────────────────────────────────────
const DB = {
  users: [
    {
      id: '1',
      name: 'Demo User',
      email: 'user@demo.com',
      password: bcrypt.hashSync('pass123', 10),
      role: 'user',
      createdAt: '2026-04-01'
    },
    {
      id: '2',
      name: 'Admin',
      email: 'admin@demo.com',
      password: bcrypt.hashSync('admin123', 10),
      role: 'admin',
      createdAt: '2026-04-01'
    }
  ],
  reviews: [
    { id: '1', userId: '1', userName: 'Demo User', product: 'Wireless Headphones', stars: 5, text: 'Amazing sound quality, very comfortable. Best headphones I have ever used!', sentiment: 'Positive', prediction: 'Genuine', confidence: 92, mismatch: false, deleted: false, date: '2026-04-01' },
    { id: '2', userId: '1', userName: 'Demo User', product: 'USB Cable', stars: 1, text: 'Excellent product great value highly recommend this wonderful item', sentiment: 'Positive', prediction: 'Fake', confidence: 88, mismatch: true, deleted: false, date: '2026-04-02' },
    { id: '3', userId: '1', userName: 'Demo User', product: 'Laptop Stand', stars: 4, text: 'Sturdy and well built. Arrived on time, packaging was good.', sentiment: 'Positive', prediction: 'Genuine', confidence: 85, mismatch: false, deleted: false, date: '2026-04-03' },
    { id: '4', userId: '1', userName: 'Demo User', product: 'Phone Case', stars: 5, text: 'Terrible quality broke after one day waste of money', sentiment: 'Negative', prediction: 'Fake', confidence: 91, mismatch: true, deleted: false, date: '2026-04-04' },
    { id: '5', userId: '1', userName: 'Demo User', product: 'Desk Lamp', stars: 3, text: 'Average product, works as expected. Nothing special.', sentiment: 'Neutral', prediction: 'Genuine', confidence: 78, mismatch: false, deleted: false, date: '2026-04-05' }
  ]
};
 
// ─── Analysis Engine ──────────────────────────────────────────────────────────
function getSentiment(text) {
  const t = text.toLowerCase();
  const posWords = ['great','amazing','excellent','wonderful','best','love','perfect','good','fantastic','awesome','quality','recommend','happy','satisfied','outstanding','superb'];
  const negWords = ['terrible','worst','bad','horrible','awful','waste','broke','poor','disappointing','useless','cheap','broken','never','hate','regret','wrong'];
  let score = 0;
  posWords.forEach(w => { if (t.includes(w)) score++; });
  negWords.forEach(w => { if (t.includes(w)) score--; });
  if (score > 0) return 'Positive';
  if (score < 0) return 'Negative';
  return 'Neutral';
}
 
function detectFake(text, stars) {
  const sentiment = getSentiment(text);
  const starNum = parseInt(stars) || 3;
  let suspicion = 0;
  let reasons = [];
 
  if (sentiment === 'Positive' && starNum <= 2) { suspicion += 40; reasons.push('Positive text with low star rating'); }
  if (sentiment === 'Negative' && starNum >= 4) { suspicion += 45; reasons.push('Negative text with high star rating'); }
  if (text.split(' ').length < 5) { suspicion += 20; reasons.push('Extremely short review'); }
 
  const spamPhrases = ['highly recommend','great value','best product','wonderful item','must buy','five stars','best in the world','absolutely perfect','no flaws','perfect product','love this product','best ever','changed my life','incredible product','totally worth','zero complaints','flawless','outstanding quality'];
  spamPhrases.forEach(p => { if (text.toLowerCase().includes(p)) { suspicion += 20; reasons.push(`Over-the-top praise phrase: "${p}"`); }});
 
  const capsWords = (text.match(/\b[A-Z]{2,}\b/g) || []).filter(w => !['I','OK','US','TV'].includes(w));
  if (capsWords.length >= 2) { suspicion += 25; reasons.push(`Multiple ALL CAPS words (${capsWords.join(', ')})`); }
  else if (capsWords.length === 1) { suspicion += 15; reasons.push(`ALL CAPS word detected (${capsWords[0]})`); }
 
  const promoWords = ['buy now','order now','click here','visit our','check out','limited offer','limited time','discount','coupon','promo code','free shipping','sale','deal','special offer','exclusive offer','sponsored','advertisement','affiliate','paid review','get yours','shop now','use code','act now','hurry','money back','guarantee','100% satisfaction','no risk'];
  let promoHits = 0;
  promoWords.forEach(p => { if (text.toLowerCase().includes(p)) promoHits++; });
  if (promoHits >= 2) { suspicion += 35; reasons.push(`Multiple promotional phrases (${promoHits} found)`); }
  else if (promoHits === 1) { suspicion += 20; reasons.push('Promotional/advertisement language detected'); }
 
  const specialCharMatches = text.match(/[!?$#@*%^&+=~|<>{}[\]\\]/g) || [];
  const specialCharCount = specialCharMatches.length;
  const repeatedSpecial = (text.match(/([!?$#@*%^&]{2,})/g) || []).length;
  const emojiCount = (text.match(/[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/gu) || []).length;
  if (repeatedSpecial >= 1 || specialCharCount > 4) { suspicion += 35; reasons.push(`Excessive special characters (${specialCharCount} found)`); }
  else if (specialCharCount > 2) { suspicion += 15; reasons.push('Unusual number of special characters'); }
  if (emojiCount > 4) { suspicion += 20; reasons.push(`Excessive emoji usage (${emojiCount} emojis)`); }
 
  const words = text.toLowerCase().split(/\s+/);
  const unique = new Set(words);
  if (words.length > 8 && unique.size / words.length < 0.5) { suspicion += 20; reasons.push('High word repetition'); }
 
  const isFake = suspicion >= 30;
  const confidence = Math.min(95, Math.max(55, 60 + suspicion));
  return { isFake, confidence, reasons, mismatch: sentiment === 'Positive' && starNum <= 2 || sentiment === 'Negative' && starNum >= 4 };
}
 
// ─── Middleware ───────────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
 
function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}
 
// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
  if (DB.users.find(u => u.email === email)) return res.status(400).json({ error: 'Email already registered' });
 
  const hashed = bcrypt.hashSync(password, 10);
  const user = { id: uuidv4(), name, email, password: hashed, role: 'user', createdAt: new Date().toISOString().slice(0,10) };
  DB.users.push(user);
 
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});
 
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = DB.users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});
 
// ─── Review Routes ────────────────────────────────────────────────────────────
app.get('/api/reviews/my', authMiddleware, (req, res) => {
  const mine = DB.reviews.filter(r => r.userId === req.user.id && !r.deleted);
  res.json(mine);
});
 
app.post('/api/reviews', authMiddleware, (req, res) => {
  const { product, stars, text } = req.body;
  if (!product || !text) return res.status(400).json({ error: 'Product and review text required' });
 
  const sentiment = getSentiment(text);
  const { isFake, confidence, reasons, mismatch } = detectFake(text, stars);
 
  const review = {
    id: uuidv4(),
    userId: req.user.id,
    userName: req.user.name,
    product,
    stars: parseInt(stars) || 3,
    text,
    sentiment,
    prediction: isFake ? 'Fake' : 'Genuine',
    confidence,
    reasons,
    mismatch,
    deleted: false,
    date: new Date().toISOString().slice(0, 10)
  };
  DB.reviews.push(review);
  res.status(201).json(review);
});
 
app.post('/api/analyze', (req, res) => {
  const { text, stars } = req.body;
  if (!text) return res.status(400).json({ error: 'Review text required' });
 
  const sentiment = getSentiment(text);
  const { isFake, confidence, reasons, mismatch } = detectFake(text, stars || '3');
  const polarity = sentiment === 'Positive' ? 0.7 : sentiment === 'Negative' ? -0.6 : 0.0;
 
  res.json({ sentiment, isFake, confidence, reasons, mismatch, polarity });
});
 
// ─── Admin Routes ─────────────────────────────────────────────────────────────
app.get('/api/admin/reviews', adminMiddleware, (req, res) => {
  res.json(DB.reviews.filter(r => !r.deleted));
});
 
app.delete('/api/admin/reviews/:id', adminMiddleware, (req, res) => {
  const review = DB.reviews.find(r => r.id === req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (review.prediction !== 'Fake') return res.status(403).json({ error: 'Only fake reviews can be deleted' });
  review.deleted = true;
  res.json({ success: true });
});
 
app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  const reviews = DB.reviews.filter(r => !r.deleted);
  const fakes = reviews.filter(r => r.prediction === 'Fake');
  const sentCounts = { Positive: 0, Negative: 0, Neutral: 0 };
  reviews.forEach(r => sentCounts[r.sentiment]++);
  res.json({
    total: reviews.length,
    fake: fakes.length,
    genuine: reviews.length - fakes.length,
    fakeRate: reviews.length ? Math.round(fakes.length / reviews.length * 100) : 0,
    sentimentBreakdown: sentCounts
  });
});
 
// ─── Dashboard (public stats) ─────────────────────────────────────────────────
app.get('/api/dashboard', (req, res) => {
  const reviews = DB.reviews.filter(r => !r.deleted);
  const fakes = reviews.filter(r => r.prediction === 'Fake');
  const sentCounts = { Positive: 0, Negative: 0, Neutral: 0 };
  reviews.forEach(r => sentCounts[r.sentiment]++);
  res.json({
    total: reviews.length,
    fake: fakes.length,
    genuine: reviews.length - fakes.length,
    fakeRate: reviews.length ? Math.round(fakes.length / reviews.length * 100) : 0,
    sentimentBreakdown: sentCounts,
    reviews: reviews.map(r => ({ id: r.id, product: r.product, stars: r.stars, sentiment: r.sentiment, prediction: r.prediction, confidence: r.confidence, date: r.date }))
  });
});
 
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
 
app.listen(PORT, () => {
  console.log(`\n🛡️  ReviewGuard API running on http://localhost:${PORT}`);
  console.log(`\n📋 Demo credentials:`);
  console.log(`   User:  user@demo.com / pass123`);
  console.log(`   Admin: admin@demo.com / admin123\n`);
});