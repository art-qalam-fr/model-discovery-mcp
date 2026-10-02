let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const parsed = JSON.parse(data.trim());
    const text = parsed.result.contents[0].text;
    const models = JSON.parse(text);
    // markdown table
    console.log('| ID | Name | Description | Context Length |');
    console.log('|----|------|-------------|----------------|');
    models.forEach(m => {
      const id = m.id || '';
      const name = m.name || '';
      const desc = (m.description || '').replace(/\|/g, '\|').replace(/\n/g, ' ');
      const ctx = m.context_length || 0;
      console.log(`| ${id} | ${name} | ${desc} | ${ctx} |`);
    });
  } catch(e) {
    console.error('Error processing models:', e.message);
  }
});
