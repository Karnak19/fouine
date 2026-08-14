import { Bench } from 'tinybench'
import { Elysia } from 'elysia'
import { staticPlugin } from '../src'
import { req } from '../test/utils'

const bench = new Bench({ time: 10000 })

const app = new Elysia().use(
    staticPlugin({
        assets: 'public',
        prefix: 'public',
        indexHTML: true,
        bunFullstack: false,
        alwaysStatic: true
    })
)
await app.modules
console.log(app.routes)
bench.add('route caching', async () => {
    const htmlPaths = [
        '/public/html',
        '/public/html/',
        '/public/html/index.html',
        '/public/html/index.html/'
    ]
    for (const path of htmlPaths) {
        const res = await app.handle(req(path))
        await (await res.blob()).text()
    }
})

await bench.run()
console.table(bench.table())
