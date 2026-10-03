package models

import (
	"fmt"
	"slices"
	"strings"
	"unicode"
)

// allowedArgs is the allowlist for user-supplied yt-dlp options (flag -> takes a value).
// It's an allowlist on purpose: many yt-dlp options run commands (--exec, --netrc-cmd),
// load code (--plugin-dirs, --use-postprocessor), redefine options (--alias) or read/write
// arbitrary server paths (-o, -P, --cookies, --config-locations, --batch-file).
// Only add options that just shape the download itself.
var allowedArgs = map[string]bool{
	// Format & post-processing
	"-f": true, "--format": true, "-S": true, "--format-sort": true, "--check-formats": false,
	"--prefer-free-formats": false, "--merge-output-format": true, "--remux-video": true,
	"--recode-video": true, "-x": false, "--extract-audio": false, "--audio-format": true,
	"--audio-quality": true, "-k": false, "--keep-video": false, "--download-sections": true,
	"--force-keyframes-at-cuts": false, "--live-from-start": false,
	// Embedding & side files (written next to the download)
	"--embed-chapters": false, "--no-embed-chapters": false, "--embed-subs": false,
	"--no-embed-subs": false, "--embed-thumbnail": false, "--no-embed-thumbnail": false,
	"--embed-metadata": false, "--no-embed-metadata": false, "--embed-info-json": false,
	"--write-subs": false, "--write-auto-subs": false, "--sub-langs": true, "--sub-format": true,
	"--convert-subs": true, "--write-thumbnail": false, "--convert-thumbnails": true,
	"--write-description": false, "--xattrs": false, "--no-mtime": false,
	"--restrict-filenames": false, "--windows-filenames": false,
	// SponsorBlock
	"--sponsorblock-remove": true, "--sponsorblock-mark": true, "--no-sponsorblock": false,
	// Network
	"-r": true, "--limit-rate": true, "--throttled-rate": true, "-R": true, "--retries": true,
	"--fragment-retries": true, "-N": true, "--concurrent-fragments": true,
	"--http-chunk-size": true, "--socket-timeout": true, "--sleep-requests": true,
	"--sleep-interval": true, "--max-sleep-interval": true, "-4": false, "--force-ipv4": false,
	"-6": false, "--force-ipv6": false, "--no-check-certificates": false, "--no-part": false,
	"--hls-use-mpegts": false, "--abort-on-unavailable-fragments": false,
	"--skip-unavailable-fragments": false, "--max-filesize": true, "--min-filesize": true,
	"--add-headers": true, "--xff": true, "--impersonate": true,
	// ponytail: extractor args are free-form; fine without third-party PO-token plugins
	// installed (some take script paths). Revisit if plugins are ever added to the image.
	"--extractor-args": true,
}

// AllowedArgs lists the accepted flags, for the UI.
func AllowedArgs() []string {
	list := make([]string, 0, len(allowedArgs))
	for k, takesValue := range allowedArgs {
		if takesValue {
			k += " …"
		}
		list = append(list, k)
	}
	slices.Sort(list)
	return list
}

// ParseArgs splits s like a shell (single/double quotes, no escapes) and checks every
// option against the allowlist. The result is safe to append before the "--" URL separator.
func ParseArgs(s string) ([]string, error) {
	if len(s) > 1000 {
		return nil, UserErr("args_too_long", "custom options are too long (1000 characters max)", map[string]any{"max": 1000})
	}
	tokens, err := splitArgs(s)
	if err != nil {
		return nil, err
	}
	for i := 0; i < len(tokens); i++ {
		name, hasValue := tokens[i], false
		if strings.HasPrefix(name, "--") {
			name, _, hasValue = strings.Cut(name, "=")
		}
		if !strings.HasPrefix(name, "-") {
			return nil, UserErr("arg_unexpected", fmt.Sprintf("unexpected %q: options must start with - (the link goes in the link field)", tokens[i]), map[string]any{"arg": tokens[i]})
		}
		takesValue, ok := allowedArgs[name]
		switch {
		case !ok:
			return nil, UserErr("arg_not_allowed", name+" isn't allowed (see the list of allowed options)", map[string]any{"arg": name})
		case takesValue && !hasValue:
			if i+1 >= len(tokens) {
				return nil, UserErr("arg_needs_value", name+" needs a value", map[string]any{"arg": name})
			}
			i++ // yt-dlp takes the next token as the value, even if it starts with "-"
		case !takesValue && hasValue:
			return nil, UserErr("arg_no_value", name+" doesn't take a value", map[string]any{"arg": name})
		}
	}
	return tokens, nil
}

func splitArgs(s string) ([]string, error) {
	var args []string
	var cur strings.Builder
	var quote rune
	inArg := false
	for _, r := range s {
		switch {
		case quote != 0 && r == quote:
			quote = 0
		case quote != 0:
			cur.WriteRune(r)
		case r == '"' || r == '\'':
			quote, inArg = r, true
		case unicode.IsSpace(r):
			if inArg {
				args = append(args, cur.String())
				cur.Reset()
				inArg = false
			}
		default:
			cur.WriteRune(r)
			inArg = true
		}
	}
	if quote != 0 {
		return nil, UserErr("args_unclosed_quote", "unclosed quote in custom options", nil)
	}
	if inArg {
		args = append(args, cur.String())
	}
	return args, nil
}
