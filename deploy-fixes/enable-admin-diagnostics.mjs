import fs from 'node:fs';

const file = process.argv[2] || 'src/handler.js';
const source = fs.readFileSync(file, 'utf8');
const before = `  } catch (e) {
    const message = e instanceof AppError ? e.message : 'Server error; records unchanged / 服务器错误，资料未更改';
    return jsonResponse(request, e instanceof AppError ? e.status : 500, { error:message, code:e instanceof AppError ? (e.code || 'error') : 'error' });
  }
`;
const after = `  } catch (e) {
    const known = e instanceof AppError;
    let message = known ? e.message : 'Server error; records unchanged / 服务器错误，资料未更改';
    if (!known) {
      const route = new URL(request.url).pathname;
      const errorName = e instanceof Error ? e.name : 'UnknownError';
      const errorMessage = String(e?.message || e || 'Unknown error').replace(/[\\r\\n\\t]+/g, ' ').slice(0, 240);
      console.error('[yourz] Unhandled server exception', {
        route, method: request.method, errorName, errorMessage,
        stack: String(e?.stack || '').slice(0, 1200)
      });
      // Show a short diagnostic only to a currently authenticated administrator.
      // Never return stack traces, cookies, request bodies, or secrets to ordinary users.
      try {
        const session = env?.DB ? await currentSession(request, env.DB) : null;
        if (session?.role === 'admin') message += ' / 管理员诊断：' + errorName + ': ' + errorMessage;
      } catch { /* Keep the generic message if the session cannot be checked. */ }
    }
    return jsonResponse(request, known ? e.status : 500, { error:message, code:known ? (e.code || 'error') : 'error' });
  }
`;
if (!source.includes(before)) throw new Error('Expected error handler was not found; refusing to modify source.');
fs.writeFileSync(file, source.replace(before, after));
console.log('Enabled safe admin-only server error diagnostics.');
