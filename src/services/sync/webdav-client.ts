// src/services/sync/webdav-client.ts
/**
 * WebDAV 客户端实现
 * 提供基础的 WebDAV 文件操作功能
 */

import { logger } from '@/lib/logger';
import { simpleFetch } from '@/lib/tauri-fetch';
import type { WebDAVConfig } from '@/types';

/**
 * WebDAV 客户端类
 */
export class WebDAVClient {
  private config: WebDAVConfig;
  private authHeader: string;

  constructor(config: WebDAVConfig) {
    this.config = config;
    // 使用浏览器兼容的 base64 编码方法
    const authString = `${config.username}:${config.password}`;
    this.authHeader = `Basic ${this.base64Encode(authString)}`;
  }

  /**
   * Base64 编码（浏览器/Tauri 兼容）
   */
  private base64Encode(str: string): string {
    try {
      // 方法1: 尝试直接使用 btoa (适用于 ASCII 字符)
      return btoa(str);
    } catch (_e) {
      // 方法2: 处理 Unicode 字符
      const encoder = new TextEncoder();
      const data = encoder.encode(str);
      let binary = '';
      for (let i = 0; i < data.byteLength; i++) {
        const byte = data[i];
        if (byte === undefined) {
          continue;
        }
        binary += String.fromCharCode(byte);
      }
      return btoa(binary);
    }
  }

  /**
   * 获取完整的 URL
   */
  private getFullPath(path: string, includeSyncPath: boolean = true): string {
    // 移除 URL 和路径的首尾斜杠，然后重新拼接
    const baseUrl = this.config.url.replace(/\/+$/, '');
    const syncPath = this.config.syncPath.replace(/^\/+|\/+$/g, '');
    const cleanPath = path.replace(/^\/+|\/+$/g, '');

    const parts = [baseUrl];

    // 添加同步路径（如果需要）
    if (includeSyncPath && syncPath) {
      parts.push(syncPath);
    }

    // 添加文件路径
    if (cleanPath) {
      parts.push(cleanPath);
    }

    return parts.join('/');
  }

  /**
   * 执行 HTTP 请求
   */
  private async request(
    method: string,
    path: string,
    headers?: Record<string, string>,
    body?: BodyInit | null,
    timeout?: number,
    includeSyncPath: boolean = true
  ): Promise<Response> {
    let url = this.getFullPath(path, includeSyncPath);

    // 对于目录操作，确保 URL 以斜杠结尾
    if (['PROPFIND', 'MKCOL'].includes(method) && !url.endsWith('/')) {
      url = `${url}/`;
    }

    const _requestTimeout = timeout ?? this.config.timeout ?? 30000;

    logger.debug(`WebDAV ${method} ${url}`);

    try {
      // 使用 Tauri 的 simpleFetch 而不是原生 fetch
      const response = await simpleFetch(url, {
        method,
        headers: {
          Authorization: this.authHeader,
          ...headers,
        },
        body,
      });

      if (!response.ok && response.status !== 404 && response.status !== 207) {
        throw new Error(`WebDAV request failed: ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('WebDAV request timeout');
      }
      throw error;
    }
  }

  /**
   * 检查文件/目录是否存在
   */
  async exists(path: string): Promise<boolean> {
    try {
      const response = await this.request('HEAD', path);
      return response.ok || response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * 获取文件内容
   */
  async getFile(path: string): Promise<string> {
    const response = await this.request('GET', path);

    if (!response.ok) {
      throw new Error(`Failed to get file: ${path}`);
    }

    return await response.text();
  }

  /**
   * 获取文件为 ArrayBuffer
   */
  async getFileBinary(path: string): Promise<ArrayBuffer> {
    const response = await this.request('GET', path);

    if (!response.ok) {
      throw new Error(`Failed to get file: ${path}`);
    }

    return await response.arrayBuffer();
  }

  /**
   * 上传文件
   */
  async putFile(path: string, content: string): Promise<void> {
    const response = await this.request(
      'PUT',
      path,
      { 'Content-Type': 'application/json' },
      content
    );

    if (!response.ok && response.status !== 201 && response.status !== 204) {
      throw new Error(`Failed to put file: ${path}`);
    }

    logger.debug(`WebDAV uploaded: ${path}`);
  }

  /**
   * 上传二进制文件
   */
  async putFileBinary(path: string, content: ArrayBuffer): Promise<void> {
    const response = await this.request(
      'PUT',
      path,
      { 'Content-Type': 'application/octet-stream' },
      content
    );

    if (!response.ok && response.status !== 201 && response.status !== 204) {
      throw new Error(`Failed to put file: ${path}`);
    }

    logger.debug(`WebDAV uploaded binary: ${path}`);
  }

  /**
   * 删除文件
   */
  async deleteFile(path: string): Promise<void> {
    const response = await this.request('DELETE', path);

    if (!response.ok && response.status !== 204 && response.status !== 404) {
      throw new Error(`Failed to delete file: ${path}`);
    }

    logger.debug(`WebDAV deleted: ${path}`);
  }

  /**
   * 移动/重命名文件
   */
  async moveFile(oldPath: string, newPath: string): Promise<void> {
    const destination = this.getFullPath(newPath);
    const response = await this.request('MOVE', oldPath, {
      Destination: destination,
      Overwrite: 'T',
    });

    if (!response.ok && response.status !== 201 && response.status !== 204) {
      throw new Error(`Failed to move file: ${oldPath} -> ${newPath}`);
    }

    logger.debug(`WebDAV moved: ${oldPath} -> ${newPath}`);
  }

  /**
   * 创建目录
   */
  async createDirectory(path: string): Promise<void> {
    const response = await this.request('MKCOL', path);

    if (!response.ok && response.status !== 201 && response.status !== 405) {
      // 405 Method Not Allowed 表示目录已存在
      throw new Error(`Failed to create directory: ${path}`);
    }

    logger.debug(`WebDAV created directory: ${path}`);
  }

  /**
   * 列出目录内容
   */
  async listDirectory(path: string = ''): Promise<string[]> {
    let url = this.getFullPath(path);
    if (!url.endsWith('/')) {
      url = `${url}/`;
    }

    const depth = path === '' ? '1' : '1';

    const response = await simpleFetch(url, {
      method: 'PROPFIND',
      headers: {
        Authorization: this.authHeader,
        Depth: depth,
      },
    });

    if (!response.ok && response.status !== 207) {
      throw new Error(`Failed to list directory: ${path}`);
    }

    if (response.status === 404) {
      return [];
    }

    const text = await response.text();
    return this.parsePROPFINDResponse(text, path);
  }

  /**
   * 解析 PROPFIND 响应
   */
  private parsePROPFINDResponse(xml: string, basePath: string): string[] {
    const paths: string[] = [];

    // 简单的 XML 解析 (生产环境应使用 DOMParser)
    const hrefRegex = /<D:href>([^<]+)<\/D:href>/g;
    const collectionRegex = /<D:collection\s*\/>/;
    const hrefs = xml.matchAll(hrefRegex);

    const baseUrl = this.getFullPath(basePath);

    for (const match of hrefs) {
      const href = match[1];
      if (!href) {
        continue;
      }
      // 解码 URL
      const decodedHref = decodeURIComponent(href);

      // 获取相对路径
      let relativePath = decodedHref.replace(baseUrl, '').replace(/^\//, '');

      // 跳过根目录和当前目录
      if (relativePath === '' || relativePath === basePath) {
        continue;
      }

      // 检查是否为集合(目录)
      const contextStart = xml.indexOf(match[0]);
      const contextEnd = xml.indexOf('</D:href>', contextStart) + 10;
      const context = xml.substring(contextStart, contextEnd);

      // 如果是目录,添加 / 后缀
      if (collectionRegex.test(context)) {
        relativePath += '/';
      }

      paths.push(relativePath);
    }

    return paths;
  }

  /**
   * 获取文件元数据
   */
  async getMetadata(path: string): Promise<{
    size: number;
    lastModified: string;
    etag?: string;
  } | null> {
    try {
      const response = await this.request('HEAD', path);

      if (!response.ok) {
        return null;
      }

      const size = parseInt(response.headers.get('Content-Length') || '0', 10);
      const lastModified = response.headers.get('Last-Modified') || '';
      const etag = response.headers.get('ETag') || undefined;

      return { size, lastModified, etag };
    } catch {
      return null;
    }
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<{ success: boolean; error?: string; pathExists?: boolean }> {
    try {
      logger.info('Testing WebDAV connection...', {
        url: this.config.url,
        syncPath: this.config.syncPath,
        username: this.config.username,
      });

      // 步骤1: 测试 WebDAV 根目录是否可访问
      const rootUrl = this.getFullPath('', false);
      logger.info(`Testing WebDAV root: ${rootUrl}`);

      // 先用简单的 HEAD 请求测试根目录
      try {
        const headResponse = await simpleFetch(rootUrl, {
          method: 'HEAD',
          headers: {
            Authorization: this.authHeader,
          },
        });

        logger.info(`WebDAV root HEAD response status: ${headResponse.status}`);

        if (headResponse.status === 401) {
          return {
            success: false,
            pathExists: false,
            error: '认证失败：用户名或密码错误，请检查您的凭据。',
          };
        }

        if (
          !headResponse.ok &&
          headResponse.status !== 404 &&
          headResponse.status !== 200 &&
          headResponse.status !== 207
        ) {
          const errorText = await headResponse.text().catch(() => 'Unknown error');
          return {
            success: false,
            pathExists: false,
            error: `无法访问 WebDAV 根目录 (HTTP ${headResponse.status}): ${errorText}`,
          };
        }
      } catch (headError) {
        logger.error('HEAD request failed:', headError);
        // HEAD 失败不是致命错误，继续尝试 PROPFIND
      }

      // 使用 PROPFIND 检查（对目录 URL 添加尾部斜杠）
      const rootUrlWithSlash = rootUrl.endsWith('/') ? rootUrl : `${rootUrl}/`;
      logger.info(`Testing with PROPFIND: ${rootUrlWithSlash}`);

      const rootResponse = await simpleFetch(rootUrlWithSlash, {
        method: 'PROPFIND',
        headers: {
          Authorization: this.authHeader,
          Depth: '0',
        },
      });

      logger.info(`WebDAV root PROPFIND response status: ${rootResponse.status}`);

      if (!rootResponse.ok && rootResponse.status !== 207) {
        const errorText = await rootResponse.text().catch(() => 'Unknown error');
        logger.error(`WebDAV root connection failed: ${errorText}`);

        if (rootResponse.status === 404) {
          return {
            success: false,
            pathExists: false,
            error: `WebDAV 路径不存在。请检查 URL 是否正确（对于坚果云，应该是：https://dav.jianguoyun.com/dav/）`,
          };
        }

        return {
          success: false,
          pathExists: false,
          error: `无法连接到 WebDAV 服务器 (HTTP ${rootResponse.status}): ${errorText}`,
        };
      }

      // 步骤2: 检查同步路径是否存在
      const syncPathUrl = this.getFullPath('', true);
      logger.info(`Checking sync path: ${syncPathUrl}`);

      const syncPathUrlWithSlash = syncPathUrl.endsWith('/') ? syncPathUrl : `${syncPathUrl}/`;
      logger.info(`Testing sync path with PROPFIND: ${syncPathUrlWithSlash}`);

      const syncPathResponse = await simpleFetch(syncPathUrlWithSlash, {
        method: 'PROPFIND',
        headers: {
          Authorization: this.authHeader,
          Depth: '0',
        },
      });

      logger.info(`Sync path response status: ${syncPathResponse.status}`);

      if (syncPathResponse.ok || syncPathResponse.status === 207) {
        logger.info('WebDAV connection test successful, sync path exists');
        return { success: true, pathExists: true };
      } else if (syncPathResponse.status === 404) {
        logger.info('WebDAV connection successful, but sync path does not exist');
        return {
          success: true,
          pathExists: false,
          error: '连接成功！但同步路径不存在，保存配置时会自动创建。',
        };
      } else {
        const errorText = await syncPathResponse.text().catch(() => 'Unknown error');
        return {
          success: false,
          pathExists: false,
          error: `同步路径检查失败 (HTTP ${syncPathResponse.status}): ${errorText}`,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('WebDAV connection test failed:', errorMessage);
      return { success: false, pathExists: false, error: errorMessage };
    }
  }

  /**
   * 获取配置
   */
  getConfig(): WebDAVConfig {
    return { ...this.config };
  }
}
