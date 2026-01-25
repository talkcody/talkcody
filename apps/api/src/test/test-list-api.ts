// Test list API response
import { app } from '../index';

async function testListApi() {
  try {
    console.log('Testing list agents API...\n');

    const res = await app.request('/api/remote-agents/configs');

    if (res.status !== 200) {
      console.log(`❌ API returned status: ${res.status}`);
      return;
    }

    const data = (await res.json()) as {
      agents: Array<{
        name: string;
        slug: string;
        author: { name: string; id: string; agentCount: number };
      }>;
    };

    console.log(`✅ Found ${data.agents.length} agents\n`);

    // Check each agent's author.agentCount
    data.agents.forEach((agent, index: number) => {
      console.log(`${index + 1}. ${agent.name} (${agent.slug})`);
      console.log(`   - Author: ${agent.author.name}`);
      console.log(`   - Author ID: ${agent.author.id}`);
      console.log(`   - Author agentCount: ${agent.author.agentCount}`);
      console.log('');
    });
  } catch (error) {
    console.error('❌ Error:', error);
  }

  process.exit(0);
}

testListApi();
