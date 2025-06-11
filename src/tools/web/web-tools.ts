import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import lighthouse from 'lighthouse';
import { BaseTool, ToolResult } from '../base-tool.js';

export class WebTools extends BaseTool {
  private async launchBrowser() {
    return await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  async fetchHtml(args: { url: string; headers?: Record<string, string> }): Promise<ToolResult> {
    try {
      const { url, headers = {} } = args;
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...headers,
        },
        timeout: 30000,
      });
      
      const result = {
        url,
        contentType: 'text/html',
        content: response.data,
        statusCode: response.status,
        headers: response.headers,
        timestamp: new Date().toISOString(),
      };
      
      return this.createJsonResult(result);
    } catch (error) {
      return this.handleError(error, `Fetch HTML from ${args.url}`);
    }
  }

  async fetchJson(args: { url: string; headers?: Record<string, string> }): Promise<ToolResult> {
    try {
      const { url, headers = {} } = args;
      
      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...headers,
        },
        timeout: 30000,
      });
      
      let jsonData = response.data;
      if (typeof jsonData === 'string') {
        try {
          jsonData = JSON.parse(jsonData);
        } catch (parseError) {
          throw new Error(`Invalid JSON response: ${parseError instanceof Error ? parseError.message : 'Parse error'}`);
        }
      }
      
      const result = {
        url,
        contentType: 'application/json',
        data: jsonData,
        statusCode: response.status,
        headers: response.headers,
        timestamp: new Date().toISOString(),
      };
      
      return this.createJsonResult(result);
    } catch (error) {
      return this.handleError(error, `Fetch JSON from ${args.url}`);
    }
  }

  async fetchText(args: { url: string; headers?: Record<string, string> }): Promise<ToolResult> {
    try {
      const { url, headers = {} } = args;
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...headers,
        },
        timeout: 30000,
      });
      
      const $ = cheerio.load(response.data) as cheerio.CheerioAPI;
      $('script, style, noscript').remove();
      
      const textContent = $.text()
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim();
      
      const result = {
        url,
        contentType: 'text/plain',
        content: textContent,
        statusCode: response.status,
        originalLength: response.data.length,
        extractedLength: textContent.length,
        timestamp: new Date().toISOString(),
      };
      
      return this.createJsonResult(result);
    } catch (error) {
      return this.handleError(error, `Fetch text from ${args.url}`);
    }
  }

  async captureScreenshot(args: { 
    url: string; 
    fullPage?: boolean; 
    viewport?: { width: number; height: number } 
  }): Promise<ToolResult> {
    const browser = await this.launchBrowser();
    const page = await browser.newPage();
    
    try {
      const { url, fullPage = true, viewport = { width: 1280, height: 720 } } = args;
      
      await page.setViewport(viewport);
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      const screenshot = await page.screenshot({
        fullPage,
        encoding: 'base64',
      });
      
      const result = {
        url,
        screenshotData: screenshot.toString().substring(0, 100) + '...',
        fullPage,
        viewport,
        timestamp: new Date().toISOString(),
      };
      
      return this.createJsonResult(result);
    } catch (error) {
      return this.handleError(error, `Capture screenshot from ${args.url}`);
    } finally {
      await browser.close();
    }
  }

  private async runLighthouseAudit(url: string, categories: string[]) {
    const browser = await this.launchBrowser();
    
    try {
      const result = await lighthouse(url, {
        port: parseInt(new URL(browser.wsEndpoint()).port, 10),
        output: 'json',
        onlyCategories: categories,
      });
      
      return result;
    } finally {
      await browser.close();
    }
  }

  async runAccessibilityAudit(args: { url: string }): Promise<ToolResult> {
    try {
      const { url } = args;
      const result = await this.runLighthouseAudit(url, ['accessibility']);
      const score = result?.lhr?.categories?.accessibility?.score || 0;
      const audits = result?.lhr?.audits || {};
      
      const accessibilityIssues = Object.values(audits)
        .filter((audit: any) => audit.score !== null && audit.score < 1)
        .map((audit: any) => ({
          id: audit.id,
          title: audit.title,
          description: audit.description,
          score: audit.score,
        }));
      
      const auditResult = {
        url,
        score: Math.round(score * 100),
        issues: accessibilityIssues,
        timestamp: new Date().toISOString(),
      };
      
      return this.createJsonResult(auditResult);
    } catch (error) {
      return this.handleError(error, `Accessibility audit for ${args.url}`);
    }
  }

  async runPerformanceAudit(args: { url: string }): Promise<ToolResult> {
    try {
      const { url } = args;
      const result = await this.runLighthouseAudit(url, ['performance']);
      const score = result?.lhr?.categories?.performance?.score || 0;
      const audits = result?.lhr?.audits || {};
      
      const performanceIssues = Object.values(audits)
        .filter((audit: any) => audit.score !== null && audit.score < 1)
        .map((audit: any) => ({
          id: audit.id,
          title: audit.title,
          description: audit.description,
          score: audit.score,
        }));
      
      const auditResult = {
        url,
        score: Math.round(score * 100),
        issues: performanceIssues,
        timestamp: new Date().toISOString(),
      };
      
      return this.createJsonResult(auditResult);
    } catch (error) {
      return this.handleError(error, `Performance audit for ${args.url}`);
    }
  }

  async analyzePageDOM(args: { url: string; selector?: string }): Promise<ToolResult> {
    const browser = await this.launchBrowser();
    const page = await browser.newPage();
    
    try {
      const { url, selector } = args;
      
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      const domAnalysis = await page.evaluate((sel) => {
        const analysis = {
          title: document.title,
          headings: [] as any[],
          images: [] as any[],
          links: [] as any[],
          forms: [] as any[],
          scripts: [] as any[],
          elementCount: 0,
        };
        
        const root = sel ? document.querySelector(sel) : document;
        if (!root) return analysis;
        
        analysis.elementCount = root.querySelectorAll('*').length;
        
        root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading: Element) => {
          analysis.headings.push({
            tag: heading.tagName.toLowerCase(),
            text: heading.textContent?.trim().substring(0, 100),
          });
        });
        
        root.querySelectorAll('img').forEach((img: HTMLImageElement) => {
          analysis.images.push({
            src: img.src,
            alt: img.alt,
            hasAlt: !!img.alt,
          });
        });
        
        root.querySelectorAll('a[href]').forEach((link: HTMLAnchorElement) => {
          analysis.links.push({
            href: link.getAttribute('href'),
            text: link.textContent?.trim().substring(0, 50),
            isExternal: link.getAttribute('href')?.startsWith('http'),
          });
        });
        
        root.querySelectorAll('form').forEach((form: HTMLFormElement) => {
          analysis.forms.push({
            action: form.action,
            method: form.method,
            inputs: form.querySelectorAll('input, textarea, select').length,
          });
        });
        
        root.querySelectorAll('script').forEach((script: HTMLScriptElement) => {
          analysis.scripts.push({
            src: script.src,
            inline: !script.src,
            type: script.type,
          });
        });
        
        return analysis;
      }, selector);
      
      const result = {
        url,
        selector: selector || 'document',
        analysis: domAnalysis,
        timestamp: new Date().toISOString(),
      };
      
      return this.createJsonResult(result);
    } catch (error) {
      return this.handleError(error, `Analyze DOM for ${args.url}`);
    } finally {
      await browser.close();
    }
  }

  async getPageConsoleLogs(args: { url: string; filter_level?: string }): Promise<ToolResult> {
    const browser = await this.launchBrowser();
    const page = await browser.newPage();
    const logs: any[] = [];
    
    try {
      const { url, filter_level = 'all' } = args;
      
      page.on('console', (msg) => {
        const level = msg.type();
        if (filter_level === 'all' || level === filter_level) {
          logs.push({
            level,
            text: msg.text(),
            timestamp: new Date().toISOString(),
          });
        }
      });
      
      await page.goto(url, { waitUntil: 'networkidle2' });
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const result = {
        url,
        filter_level,
        logs,
        timestamp: new Date().toISOString(),
      };
      
      return this.createJsonResult(result);
    } catch (error) {
      return this.handleError(error, `Get console logs from ${args.url}`);
    } finally {
      await browser.close();
    }
  }

  async getPageNetworkLogs(args: { url: string; filter_type?: string }): Promise<ToolResult> {
    const browser = await this.launchBrowser();
    const page = await browser.newPage();
    const requests: any[] = [];
    
    try {
      const { url, filter_type = 'all' } = args;
      
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        if (filter_type === 'all' || resourceType === filter_type) {
          requests.push({
            url: request.url(),
            method: request.method(),
            resourceType,
            timestamp: new Date().toISOString(),
          });
        }
      });
      
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      const result = {
        url,
        filter_type,
        requests,
        timestamp: new Date().toISOString(),
      };
      
      return this.createJsonResult(result);
    } catch (error) {
      return this.handleError(error, `Get network logs from ${args.url}`);
    } finally {
      await browser.close();
    }
  }
}
