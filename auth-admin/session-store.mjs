const lifetime = 4 * 60 * 60 * 1000;

export class AdminSessions {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    const body = await request.json(), path = new URL(request.url).pathname, now = Date.now();
    if (path === '/attempt') {
      const result = await this.ctx.storage.transaction(async storage => {
        const key = 'attempt:' + body.key, previous = await storage.get(key);
        const next = previous?.expires > now ? previous : {count: 0, expires: now + 60000};
        next.count++;
        await storage.put(key, next);
        return {allowed: next.count <= 5};
      });
      await this.scheduleCleanup();
      return Response.json(result);
    }
    if (path === '/oauth-create') {
      await this.ctx.storage.put('oauth:' + body.state, {...body, expires: now + 600000});
      await this.scheduleCleanup();
      return Response.json({created: true});
    }
    if (path === '/oauth-consume') {
      const result = await this.ctx.storage.transaction(async storage => {
        const key = 'oauth:' + body.state, entry = await storage.get(key);
        if (!entry || entry.expires <= now) {if (entry) await storage.delete(key);return null;}
        if (entry.binding !== body.binding) return null;
        await storage.delete(key);
        return entry;
      });
      return Response.json(result);
    }
    const key = 'session:' + body.id;
    if (path === '/create') {
      const session = {user: body.user, csrf: body.csrf, version: body.version, expires: now + lifetime};
      await this.ctx.storage.put(key, session);
      await this.scheduleCleanup();
      return Response.json(session);
    }
    if (path === '/delete') {
      await this.ctx.storage.delete(key);
      return Response.json({deleted: true});
    }
    if (path === '/get') {
      const session = await this.ctx.storage.get(key);
      if (!session || session.expires <= now) {
        if (session) await this.ctx.storage.delete(key);
        return Response.json(null);
      }
      return Response.json(session);
    }
    return new Response(null, {status: 404});
  }
  async scheduleCleanup() {
    if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
  async alarm() {
    const entries = await this.ctx.storage.list(), expired = [...entries].filter(([, value]) => value.expires <= Date.now()).map(([key]) => key);
    for (let index=0;index<expired.length;index+=128) await this.ctx.storage.delete(expired.slice(index,index+128));
    if (entries.size > expired.length) await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
}
