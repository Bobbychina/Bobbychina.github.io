'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const Negotiator = require('negotiator');
const { NodeHtmlMarkdown } = require('node-html-markdown');
const { load } = require('cheerio');

const htmlType = 'text/html; charset=utf-8';
const markdownType = 'text/markdown; charset=utf-8';
const markdown = new NodeHtmlMarkdown({ bulletMarker: '-', maxConsecutiveNewlines: 2 });
const portalPage = /^\/(?:(?:games|resources|sponsor)\/)?(?:index\.html)?$/;
const blogPage = /^\/posts\/(?:([A-Za-z0-9][A-Za-z0-9-]{0,119})\/)?(?:index\.html)?$/;

async function readPage(uri) {
  let root;
  let filename;
  if (portalPage.test(uri)) {
    root = process.env.PORTAL_ROOT || '/var/www/portal';
    filename = uri.endsWith('/') ? uri.slice(1) + 'index.html' : uri.slice(1);
  } else {
    const post = blogPage.exec(uri);
    if (!post) return null;
    root = process.env.BLOG_POSTS_ROOT || '/opt/stockgame/blog-dist/posts';
    filename = path.join(post[1] || '', 'index.html');
  }
  try {
    const directory = await fs.realpath(root);
    const file = await fs.realpath(path.join(directory, filename));
    if (!file.startsWith(directory + path.sep)) return null;
    const body = await fs.readFile(file);
    return /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(body.toString('utf8', 0, 512)) ? body : null;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) return null;
    throw error;
  }
}

function toMarkdown(source, uri) {
  const $ = load(source);
  const main = $('main').first();
  const content = main.length ? main : $('body');
  const base = new URL(uri, 'https://bobbycn.cc');
  content.find('script, style, template, noscript, svg, iframe, form, button, [hidden], [aria-hidden="true"], img[alt=""]').remove();
  for (const element of content.find('a[href], img[src]')) {
    const node = $(element);
    const attribute = element.tagName === 'a' ? 'href' : 'src';
    const href = node.attr(attribute);
    const target = URL.canParse(href, base) ? new URL(href, base) : null;
    if (target && (['https:', 'http:'].includes(target.protocol) || (attribute === 'href' && target.protocol === 'mailto:'))) {
      node.attr(attribute, target.href);
    } else {
      node.removeAttr(attribute);
    }
  }
  let text = markdown.translate(content.html()).trim();
  if (/^\/resources\//.test(uri)) {
    text += '\n\n[查看当前公开资源列表（JSON）](https://bobbycn.cc/api/resources)';
  }
  return text + '\n';
}

async function serve(req, res) {
  res.setHeader('Vary', 'Accept');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Signal', 'search=yes, ai-input=yes, ai-train=no');
  const uri = req.headers['x-agent-page'];
  const page = typeof uri === 'string' && await readPage(uri);
  if (!page) {
    res.writeHead(404);
    return res.end();
  }

  const preferences = new Negotiator(req);
  const explicitMarkdown = preferences.mediaTypes().some(type => type.toLowerCase() === 'text/markdown');
  const selected = preferences.mediaType(explicitMarkdown ? [htmlType, markdownType] : [htmlType]);
  if (!selected) {
    res.writeHead(406);
    return res.end();
  }
  const body = selected === htmlType ? page : Buffer.from(toMarkdown(page.toString('utf8'), uri));
  res.writeHead(200, { 'Content-Type': selected, 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
}

module.exports = { serve };
