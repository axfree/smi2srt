# smi2srt
Convert subtitles in ".smi" or ".ass" format to ".srt" format.

## Prerequisits
[Node.js](https://nodejs.org)

## Installation
<pre>
$ sudo npm install -g smi2srt
</pre>

## Usage
<pre>
Usage: smi2srt [options] <file>

smi2srt by axfree

Options:


  -h, --help                          output usage information
  -v, --version                       output the version number
  -n                                  do not overwrite an existing file
  -d, --output-directory <directory>  specify optional output directory
  -l, --list-subtitles                list subtitles
  -t, --time-offset <offset>          specify the time offset in miliseconds
  -b, --time-begin <time>             specify the time begin for offset in miliseconds or H:mm:ss
  -x, --remove-original-file          remove original file after successful conversion
  -i, --install-automator             install smi2srt OS X Automator
</pre>

## License
MIT
