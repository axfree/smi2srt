#!/usr/bin/env node

var argv      = require('commander');
var fs        = require('fs');
var path      = require('path');
var sprintf   = require('sprintf-js').sprintf;
var charsetDetector
              = require("node-icu-charset-detector");
var iconv     = require('iconv-lite');
var cheerio   = require('cheerio');

argv
    .version('1.0.2', '-v, --version')
    .description('smi2srt by axfree')
    .arguments('<file>')
    .option('-e, --encoding <encoding>', 'specify the encoding of input file')
    .option('-n', 'do not overwrite an existing file')
    .option('-o, --output <filename>', 'write to FILE')
    .option('-t, --time-offset <offset>', 'specify the time offset in miliseconds', parseInt, 0)
    .parse(process.argv);

if (argv.args.length == 0) {
    argv.outputHelp();
    process.exit(0);
}

var optSrc = argv.args[0];
var optDest = argv.output;
var optEncoding = argv.encoding;   // || "CP949";
var optTimeOffset = argv.timeOffset || 0;

var srcName = optSrc;
var srcExt;
var srcLang;

var sv = srcName.match(/^(.*?)(?:\.(en|eng|ko|kor|ja|jap))?(?:\.(smi|smil|srt|ass))?$/);
if (sv) {
    srcName = sv[1];
    srcLang = sv[2];
    srcExt = sv[3];

    if (!optEncoding && srcExt == 'srt')
        optEncoding = 'utf8';
}

var buffer = fs.readFileSync(optSrc);
var charset;

if (charsetDetector)
    charset = charsetDetector.detectCharset(buffer).toString();
else {
    charset = optEncoding || 'CP949';
    if (buffer[0] == 0xef && buffer[1] == 0xbb && buffer[2] == 0xbf)    // \uFEFF (BOM)
        charset = 'utf8';
    else if (buffer[0] == 0xff && buffer[1] == 0xfe)
        charset = 'utf16-le';
    else if (buffer[0] == 0xfe && buffer[1] == 0xff)
        charset = 'utf16-be';
}

var text = iconv.decode(buffer, charset).replace(/\r\n/g, '\n');

if (/^[\n\s]*<SAMI/i.test(text)) {
    var syncs = text.match(/(<SYNC[^]*?)(?=\s*<SYNC|\s*<\/BODY)/gi);
    if (!syncs) {
        console.log("No sync found");
        return;
    }

    var syncWithLang = {};
    syncs.forEach(function (sync, idx) {
        var sync = cheerio.load(sync.replace(/&nbsp(?!;)/i, '&nbsp;'), {
             normalizeWhitespace:true,
                         xmlMode:false,
                  decodeEntities:false
        }).html();
        var lang = sync.match(/class="(.*?)"/) [1];
        if (!syncWithLang[lang])
            syncWithLang[lang] = [];
        syncWithLang[lang].push(sync);
        // syncs[idx] = sync;
        // console.log(syncs[idx]);
    });

    for (var lang in syncWithLang) {
        var syncs = syncWithLang[lang];
        var outputFile = optDest;

        if (!outputFile) {
            var langCode = lang;
            if (/^(en|eg)/i.test(lang))
                langCode = 'en';
            else if (/^(kr|ko)/i.test(lang))
                langCode = 'ko';

            // FIX-ME
            if (Object.keys(syncWithLang).length == 1)
                langCode = srcLang || 'ko';

            outputFile = srcName + '.' + langCode + '.srt';
        }

        if (argv.n) {
            if (fs.existsSync(outputFile)) {
                console.log("File exists:", path.basename(outputFile));
                continue;
            }
        }

        console.log(outputFile);

        var $ = cheerio.load(syncs.join(), { decodeEntities:false });
        var j = 1;
        var fd = fs.openSync(outputFile, 'w');

        $('sync').each(function (i, e) {
            var sync = $(e);
            var start = parseInt(sync.attr('start'));
            var end = parseInt(sync.next().attr('start'));

            if (!end)
                return;
            if (start > end) {
                var nextStart = sync.next().next().attr('start');
                if (nextStart && nextStart - start > 500) {
                    var newEnd = start + Math.floor(Math.min(3000, (nextStart - start) / 2));
                    console.log('Sync adjusted: start=' + start + ', end=' + end + ' -> ' + newEnd);
                    end = newEnd;
                }
                else
                    throw new Error('Sync invalid: start=' + start + ', end=' + end);
            }

            var p = sync.find('p');
            if (p.length == 0)
                p = sync;

            if (p.text().trim() != '&nbsp;') {
                fs.write(fd, j + '\n');
                fs.write(fd, formatTime(start + optTimeOffset) + ' --> ' + formatTime(end + optTimeOffset) + '\n');
                fs.write(fd, p.html().replace(/<br>\s*/g, '\n').trim() + '\n');
                fs.write(fd, '\n');
                j++;
            }
            else {
            }
        });

        fs.close(fd);
    }

    return 0;
}
else if (/^1\n/.test(text)) {
    var outputFile = optDest;

    if (!outputFile)
        outputFile = srcName + '.' + (srcLang || 'ko') + '.srt';

    if (argv.n) {
        if (fs.existsSync(outputFile)) {
            console.log("File exists:", path.basename(outputFile));
            return 0;
        }
    }

    console.log(outputFile);

    var fd = fs.openSync(outputFile, 'w');
    var j = 1;

    text = text.replace(/\n[ \t]+(?=\n)/g, '\n');
    text = text.replace(/\n(?=\n\n)/g, '');
    text = text.replace(/([^\n])(\n\d+\n\d\d:)/g, '$1\n$2');

    text.split('\n\n').map(function (ln) {
        if (ln.length > 0) {
            var nln = ln.replace(/(\d+)\n(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)/,
                function(match, n, s1, s2, s3, s4, e1, e2, e3, e4) {
                    var start = 1000 * (60 * (60 * parseInt(s1) + parseInt(s2)) + parseInt(s3)) + parseInt(s4);
                    var end = 1000 * (60 * (60 * parseInt(e1) + parseInt(e2)) + parseInt(e3)) + parseInt(e4);

                    return formatTime(start + optTimeOffset) + ' --> ' + formatTime(end + optTimeOffset);
                });
            fs.write(fd, (j++) + '\n' + nln + '\n\n');
        }
    })

    fs.close(fd);

    return 0;
}
else if (/^\[Script Info\]/.test(text)) {
    // fs.writeFileSync('ass.json', JSON.stringify(sections));

    if (!outputFile)
        outputFile = srcName + '.' + (srcLang || 'ko') + '.srt';

    if (argv.n) {
        if (fs.existsSync(outputFile)) {
            console.log("File exists:", path.basename(outputFile));
            return 0;
        }
    }

    console.log(outputFile);

    var fd = fs.openSync(outputFile, 'w');

    var sections = {};
    text.split('\n\n').map(sect => {
        sect.replace(/^\[(.*?)\]\n([^]*)$/, (m, hdr, cont) => {
            sections[hdr] = cont;
        });
    });

    var j = 1;
    var events = sections['Events'];
    events.split('\n').forEach((e, idx) => {
        if (idx == 0) return;
        //          Format Layer Start                      End                        Style Name  MarginL,R,V       Effect
        e.replace(/^(.*?): (\d+),(\d):(\d\d):(\d\d)\.(\d\d),(\d):(\d\d):(\d\d)\.(\d\d),(.*?),(.*?),(\d+),(\d+),(\d+),(.*?),(.*)$/,
          (m, format, layer, s1, s2, s3, s4, e1, e2, e3, e4, style, name, marginL, marginR, marginV, effect, text) => {
              var start = 1000 * (60 * (60 * parseInt(s1) + parseInt(s2)) + parseInt(s3)) + parseInt(s4) * 10;
              var end = 1000 * (60 * (60 * parseInt(e1) + parseInt(e2)) + parseInt(e3)) + parseInt(e4) * 10;

              text = text.replace(/\{\\c&H([0-9a-f]{6})&\}(.*?)\{\\c\}/, '<font color="#$1">$2</font>')
                         .replace(/\{\\.*?}/, '')
                         .replace(/\\N/g, '\n');
              fs.write(fd, (j++) + '\n' + formatTime(start + optTimeOffset) + ' --> ' + formatTime(end + optTimeOffset) + '\n' + text + '\n\n');
          });
    });

    fs.close(fd);

    return 0;
}
else {
    console.error("Unknown file format", [ text.charCodeAt(0), text.charCodeAt(1), text.charCodeAt(2) ]);

    return 1;
}

function formatTime(t) {
    return sprintf ("%02d:%02d:%02d,%03d", (t / 3600000), ((t / 60000)) % 60, ((t / 1000)) % 60, t % 1000);
}
