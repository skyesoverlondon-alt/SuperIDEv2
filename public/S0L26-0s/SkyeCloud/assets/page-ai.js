
import { aiChat, pingHealth, setActiveNav } from '../../assets/app-core.js';

const messages = [];
function render(){
  const wrap = document.querySelector('#chat-log');
  wrap.innerHTML = messages.map(item => `<div class="message ${item.role}">${item.content.replace(/</g,'&lt;')}</div>`).join('');
  wrap.scrollTop = wrap.scrollHeight;
}
async function init(){
  setActiveNav('kAIxU Console');
  const health = await pingHealth();
  document.querySelector('#console-status').textContent = health.configured ? 'kAIxU server lane online.' : 'AI lane idle until OPENAI_API_KEY is configured.';
  document.querySelector('#send').onclick = async () => {
    const prompt = document.querySelector('#prompt').value.trim();
    if (!prompt) return;
    messages.push({ role:'user', content:prompt });
    render();
    document.querySelector('#prompt').value = '';
    messages.push({ role:'ai', content:'kAIxU is thinking…' });
    render();
    try {
      const res = await aiChat(prompt, 'You are kAIxU, the creative engineering console for SkyeCloud. Be clear, direct, and useful.');
      messages[messages.length - 1].content = res.output || 'No response.';
    } catch (err) {
      messages[messages.length - 1].content = err.message;
    }
    render();
  };
}
init();
