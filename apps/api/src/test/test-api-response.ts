// Test API response for agent detail
import { app } from '../index';

async function testApiResponse() {
  try {
    console.log('Testing API response for Translator agent...\n');

    const res = await app.request('/api/remote-agents/translator');

    if (res.status !== 200) {
      console.log(`❌ API returned status: ${res.status}`);
      return;
    }

    const data = (await res.json()) as {
      agent: { author: { name: string; id: string; agentCount: number } };
    };

    console.log('✅ API Response:');
    console.log(JSON.stringify(data, null, 2));

    console.log('\n📊 Author Info:');
    console.log(`   - Name: ${data.agent.author.name}`);
    console.log(`   - ID: ${data.agent.author.id}`);
    console.log(`   - Agent Count: ${data.agent.author.agentCount}`);
  } catch (error) {
    console.error('❌ Error:', error);
  }

  process.exit(0);
}

testApiResponse();
