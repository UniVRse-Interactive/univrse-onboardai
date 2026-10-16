// Real frontend, avatar and Kokoro voice with clearly labelled sample answers.
// Does not load .env, contact Vertex AI or read saved company conversations.
import express from 'express';
import { resolve } from 'node:path';
import { createApp } from '../server/api-routes.mjs';
import { avatarRoute } from '../server/avatar-route.mjs';

const app = express();
app.use(express.json());
app.post('/api/chat', (req, res) => {
  const question = String(req.body.question || '');
  let answer;
  if (/jeans/i.test(question))
    answer =
      'Wear jeans only if your company dress code permits them. Choose a dark, neat pair without rips. Check with HR before wearing jeans on your first day.';
  else if (/wear|clothing|casual|dress/i.test(question))
    answer =
      'Business casual can mean a smart shirt with tailored trousers. You can also choose a neat blouse with trousers or a suitable skirt. Avoid sleepwear and beachwear in the office.';
  else if (/leave|time off/i.test(question))
    answer =
      'Submit your annual leave request through the employee portal. Wait for manager approval before booking travel. Ask HR about your eligibility.';
  else if (/first.day|tasks|start/i.test(question))
    answer =
      'Check in at reception when you arrive. Bring your identification documents and laptop. Meet your manager and review your checklist.';
  else if (/hours|lunch|break|schedule/i.test(question))
    answer =
      'Normal working hours are 9:00 a.m. to 5:30 p.m., Monday to Friday. Lunch is at 12:30. Hours may vary with manager approval.';
  else if (/safety|emergency/i.test(question))
    answer =
      'Review the emergency evacuation route. Ask your team about the assembly point. Read the safety handbook before starting your tasks.';
  else if (/laptop|email|account|IT/i.test(question))
    answer =
      'Sign in to your email account using the instructions from IT support. Protect your password and report suspicious messages. Ask your manager if access is unavailable.';
  else
    answer =
      'Read your onboarding guide for the relevant policy. Ask HR if you need clarification. Your manager can explain your next tasks.';
  res.json({ answer, mode: 'demo', source: 'Visual QA · sample guidance, not company policy' });
});
app.use(createApp({ env: {} }));
app.get('/avatars/alya/alya.glb', avatarRoute('public'));
app.use(express.static(resolve('dist')));
app.get('/{*path}', (req, res) => res.sendFile(resolve('dist/index.html')));
const server = app.listen(3001, '127.0.0.1', (error) => {
  if (error) throw error;
  console.log('Onboarding visual QA with sample answers: http://localhost:3001/mira');
});
process.on('SIGINT', () => server.close());
