// The homepage and the loopback RPC service use the same public directory.
(() => {
  const sections = [
    ['作品', '/', '首页 projects home'],
    ['游戏厅', '/games/', '游戏目录 games arcade'],
    ['文章', '/posts/', '博客 blog writing posts'],
    ['共享资源', '/resources/', '下载 工具 resources tools'],
    ['P2P 文件互传', '/p2p/', 'WebRTC file transfer'],
  ];
  const games = [
    ['词锋对决 · Lexicon Arena', 'lexicon-arena', '单词 词汇 word'],
    ['丧尸末日生存 · 余烬', 'zombie-survival', '回合制 探索 survival zombie'],
    ['吸血鬼幸存者 · Vampire Survivors', 'vampire-survivors', '怪物潮 自动攻击'],
    ['极速椭圆 · 3D 赛车', 'racing3d', '赛道 racing driving'],
    ['StockGameOnlinePro', 'stock', '股票 交易 模拟 finance'],
    ['墨狂 · INK / FURY', 'ink-fury', '平台 动作 platform'],
    ['数学灵感：公理纪元', 'math-inspiration', '证明 推理 math'],
    ['Blockline · Minecraft 命令方块模拟器', 'blockline', '基岩 Java command block'],
  ];
  const entries = [
    ...sections,
    ...games.map(([title, id, keywords]) => [title, '/games/#' + id, '游戏 game ' + keywords]),
  ];
  const tool = {
    name: 'search_site_directory',
    description: 'Find public pages and game previews on Bobbychina by keyword. An empty query lists the directory.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', maxLength: 160, description: 'A page title, game name or topic in Chinese or English.' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  };

  function search(input = {}) {
    if (!input || Array.isArray(input) || typeof input !== 'object' ||
        Object.keys(input).some(key => key !== 'query')) {
      throw new TypeError('Expected an object with an optional query.');
    }
    const { query = '' } = input;
    if (typeof query !== 'string' || query.length > 160) {
      throw new TypeError('query must be a string of at most 160 characters.');
    }
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter(entry => {
      const text = entry.join(' ').toLowerCase();
      return words.every(word => text.includes(word));
    }).map(([title, path]) => ({ title, url: 'https://bobbycn.cc' + path }));
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { search, tool };
  if (typeof document !== 'undefined') {
    const context = document.modelContext || navigator.modelContext;
    if (context?.registerTool) {
      context.registerTool({
        ...tool,
        execute: async input => {
          try { return { entries: search(input) }; }
          catch (error) { return { error: error.message }; }
        },
      });
    }
  }
})();
