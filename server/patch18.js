const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

// First, remove the duplicate 'let mdexInfo;' from line 761 (which was injected after 'let fallbackResultsRaw: any[] = [];')
content = content.replace("let fallbackResultsRaw: any[] = [];\\n        let mdexInfo;", "let fallbackResultsRaw: any[] = [];");

const target = `        let primaryData, extSet, mdexInfo;
        if (canParallelizeFallbacks) {
            let mdexInfo: any;
            [primaryData, extSet, fallbackResultsRaw, mdexInfo] = await Promise.all([
                dataPromise,
                externalIdsPromise,
                Promise.all(fallbackPromises),
                mdexInfoPromise
            ]);
        } else {
            let mdexInfo: any;
            [primaryData, extSet, mdexInfo] = await Promise.all([
                dataPromise,
                externalIdsPromise,
                mdexInfoPromise
            ]);
        }`;

const replacement = `        let primaryData, extSet, mdexInfo: any;
        if (canParallelizeFallbacks) {
            [primaryData, extSet, fallbackResultsRaw, mdexInfo] = await Promise.all([
                dataPromise,
                externalIdsPromise,
                Promise.all(fallbackPromises),
                mdexInfoPromise
            ]);
        } else {
            [primaryData, extSet, mdexInfo] = await Promise.all([
                dataPromise,
                externalIdsPromise,
                mdexInfoPromise
            ]);
        }`;

content = content.replace(target, replacement);
fs.writeFileSync('src/index.ts', content);
console.log('Cleaned up mdexInfo scope perfectly');
