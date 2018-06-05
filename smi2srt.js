#!/usr/bin/env node

'use strict';

var argv      = require('commander');
var fs        = require('fs');
var path      = require('path');
var ps        = require('child_process');
var sprintf   = require('sprintf-js').sprintf;
var charsetDetector
              = require("charset-detector");
var languageDetector
              = require('langdetect');
var iconv     = require('iconv-lite');
var cheerio   = require('cheerio');

argv
    .version(require('./package').version, '-v, --version')
    .description('smi2srt by axfree')
    .arguments('<file>')
    .option('-n', 'do not overwrite an existing file')
    .option('-l, --list-subtitles', 'list subtitles')
    .option('-t, --time-offset <offset>', 'specify the time offset in miliseconds', parseInt, 0)
    .option('-b, --time-begin <time>', 'specify the time begin for offset in miliseconds or H:mm:ss', parseTime, 0)
    .option('-i, --install-automator', 'install smi2srt OS X Automator')
    .parse(process.argv);

if (argv.installAutomator) {
    ps.execFileSync('open', [ __dirname + '/Automator/Convert SMI to SRT 💬.workflow']);
    return;
}

if (argv.args.length == 0)
    argv.help();

argv.args.forEach(f => {
    var files;

    try {
        var stat = fs.statSync(f);
        if (stat.isDirectory())
            files = walk(f).filter(file => file.match(/\.(smi|smil)$/));
        else
            files = [ f ];
    } catch(e) {
        console.error(e.message);
        return;
    }

    files.forEach(file => {
        var fileMatch = file.match(/^(.*?)(?:\.(en|eng|ko|kor|ja|jap|zh-cn|chs|zh-tw|cht))?(?:\.(smi|smil|srt|ass))$/i);
        if (!fileMatch)
            return;
        var baseFile = fileMatch[1];

        var subs = readSubtitle(file);
        subs.forEach(sub => {
            var langCode = detectSubtitleLanguage(sub);
            if (langCode) {
                var outputFile = baseFile + '.' + langCode + '.srt';
                if (!argv.listSubtitles && argv.N) {
                    if (fs.existsSync(outputFile)) {
                        console.log('%s: not overwritten', path.basename(outputFile));
                        return;
                    }
                }

                console.log('%s -> %s', file, outputFile);
                if (!argv.listSubtitles)
                    writeSubtitle(outputFile, sub, argv.timeBegin, argv.timeOffset);
            }
        });
    });
});

function readSubtitle(file) {
    var buffer = fs.readFileSync(file);
    var subs = [];

    // detect charset
    var matches = charsetDetector(buffer);
    var charset = matches[0].charsetName;

    var text = iconv.decode(buffer, charset).replace(/\r\n/g, '\n');

    if (/^[\n\s]*<SAMI/i.test(text)) {
        var syncs = text.match(/(<SYNC[^]*?)(?=\s*<SYNC|\s*<\/BODY)/gi);
        if (!syncs) {
            console.error("%s: no sync found", file);
            return subs;
        }

        var syncWithLang = {};
        syncs.forEach(function (sync, idx) {
            var sync = cheerio.load(sync.replace(/&nbsp(?!;)/i, '&nbsp;'), {
                 normalizeWhitespace:true,
                             xmlMode:false,
                      decodeEntities:false
            }).html();
            var langMatch = sync.match(/class="(.*?)"/);
            var lang = langMatch ? langMatch[1] : 'unknown';
            if (!syncWithLang[lang])
                syncWithLang[lang] = [];
            syncWithLang[lang].push(sync);
        });

        for (var lang in syncWithLang) {
            var syncs = syncWithLang[lang];
            var $ = cheerio.load(syncs.join(), { decodeEntities:false });

            var sub = [];
            $('sync').get().sort((a, b) => { return +$(a).attr('start') - +$(b).attr('start') }).forEach((e, idx) => {
                var sync = $(e);
                var start = parseInt(sync.attr('start'));
                var stop = parseInt(sync.next().attr('start'));

                if (!stop)
                    return;

                var p = sync.find('p');
                if (p.length == 0)
                    p = sync;

                if (p.text() != '' && p.text().trim() != '&nbsp;') {
                    sub.push({
                        start: start,
                        stop: stop,
                        text: p.html().replace(/<br>\s*/g, '\n').trim()
                    })
                }
            });

            subs.push(sub);
        }
    }
    else if (/^[\n\s]*\d{1,3}\n/.test(text)) {
        text = text.replace(/\n[ \t]+(?=\n)/g, '\n');
        text = text.replace(/\n(?=\n\n)/g, '');
        text = text.replace(/([^\n])(\n\d+\n\d\d:)/g, '$1\n$2');

        var sub = [];
        text.split('\n\n').map(function (ln) {
            if (ln.length > 0) {
                var m = ln.match(/^(\d+)\n(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)(.*?)\n([^]*)$/m);
                if (m) {
                    sub.push({
                        start: 1000 * (60 * (60 * parseInt(m[2]) + parseInt(m[3])) + parseInt(m[4])) + parseInt(m[5]),
                        stop: 1000 * (60 * (60 * parseInt(m[6]) + parseInt(m[7])) + parseInt(m[8])) + parseInt(m[9]),
                        text: m[11]
                    });
                }
            }
        })

        subs.push(sub);
    }
    else if (/^[\n\s]*\[Script Info\]/.test(text)) {
        var sections = {};
        text.split('\n\n').map(sect => {
            sect.replace(/^\[(.*?)\]\n([^]*)$/, (m, hdr, cont) => {
                sections[hdr] = cont;
            });
        });

        var sub = [];
        var events = sections['Events'];
        events.split('\n').forEach((e, idx) => {
            if (idx == 0) return;
            //          Format Layer Start                      End                        Style Name  MarginL,R,V       Effect
            e.replace(/^(.*?): (\d+),(\d):(\d\d):(\d\d)\.(\d\d),(\d):(\d\d):(\d\d)\.(\d\d),(.*?),(.*?),(\d+),(\d+),(\d+),(.*?),(.*)$/,
              (m, format, layer, s1, s2, s3, s4, e1, e2, e3, e4, style, name, marginL, marginR, marginV, effect, text) => {
                var start = 1000 * (60 * (60 * parseInt(s1) + parseInt(s2)) + parseInt(s3)) + parseInt(s4) * 10;
                var stop = 1000 * (60 * (60 * parseInt(e1) + parseInt(e2)) + parseInt(e3)) + parseInt(e4) * 10;

                text = text.replace(/\\N/gi, '\n')
                           .replace(/{(.*?)}/g, (m, cmds) => {
                    var tags = '';
                    var tagsOpen = {};
                    cmds.split('\\').forEach((cmd, idx) => {
                        if (idx == 0) return;
                        var m = cmd.match(/^([a-z]+)(.*)$/);
                        if (m) {
                            switch (m[1]) {
                                case 'c':
                                    var colorMatch = m[2].match(/&H(..)(..)(..)&/);
                                    if (colorMatch)
                                        tags += `<font color="#${colorMatch.splice(1).reverse().join('')}">`;
                                    break;

                                case 'i':
                                case 'b':
                                case 'u':
                                    if (parseInt(m[2]) > 0) {
                                        tags += `<${m[1]}>`;
                                        tagsOpen[m[1]] = true;
                                    }
                                    else {
                                        if (tagsOpen[m[1]])
                                            tags += `</${m[1]}>`;
                                        tagsOpen[m[1]] = false;
                                    }
                                    break;

                                case 'fs':
                                case 'pos':
                                    break;

                                default:
                                    console.error('%s: unknown command %s', file, cmd);
                            }
                        }
                    });

                    return tags;
                });

                // // fix unbalanced tags
                // text = cheerio.load(text, {
                //      normalizeWhitespace:true,
                //                  xmlMode:false,
                //           decodeEntities:false
                // }).html();

                sub.push({
                    start: start,
                    stop: stop,
                    text: text
                });
            });
        });

        subs.push(sub);
    }
    else {
        console.error("%s: unknown file format %j", file, [ text.charCodeAt(0), text.charCodeAt(1), text.charCodeAt(2) ]);
    }

    return subs;
}

function writeSubtitle(file, sub, timeBegin, timeOffset) {
    var fd = fs.openSync(file, 'w');
    sub.forEach((ln, idx) => {
        var offset = ln.start >= timeBegin ? timeOffset : 0;
        fs.writeSync(fd, (idx + 1) + '\n');
        fs.writeSync(fd, formatTime(ln.start + offset) + ' --> ' + formatTime(ln.stop + offset) + '\n');
        fs.writeSync(fd, ln.text + '\n');
        fs.writeSync(fd, '\n');
    })
    fs.closeSync(fd);

    return true;
}

function detectSubtitleLanguage(sub) {
    var texts = '';
    sub.forEach(ln => {
        texts += ln.text.replace(/<.*?>/g, '');
    });
    return texts != '' ? languageDetector.detectOne(texts) : null;
}

function formatTime(t) {
    return sprintf ("%02d:%02d:%02d,%03d", (t / 3600000), ((t / 60000)) % 60, ((t / 1000)) % 60, t % 1000);
}

function parseTime(s) {
    var m = s.match(/^(?:(\d+):)?(\d\d):(\d\d)(?:,(\d\d\d))?$/);
    if (m)
        return 1000 * (60 * (60 * parseInt(m[1] || 0) + parseInt(m[2])) + parseInt(m[3])) + parseInt(m[4] || 0)

    return parseInt(s);
}

// http://stackoverflow.com/questions/5827612/node-js-fs-readdir-recursive-directory-search
function walk(dir) {
    var results = [];
    var list = fs.readdirSync(dir);
    list.forEach(function(file) {
        if (file.startsWith('._'))
            return;
        file = dir + '/' + file;
        var stat = fs.statSync(file);
        if (stat && stat.isDirectory())
            results = results.concat(walk(file));
        else
            results.push(file);
    })
    return results;
}
