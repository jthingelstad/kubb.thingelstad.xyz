#!/bin/bash
# ffmpeg for an App Store App Preview (docs/REEL.md "A cut for the App Store"). Name it
# in FFMPEG when running tools/reel/render.mjs: it passes the renderer's own two ffmpeg
# calls through with Apple's numbers in place of the shared reel's, so a preview is a
# first encode of the drawn frames and the mixed sound, not a re-encode of a reel.
#
#   FFMPEG=tools/reel/preview-ffmpeg.sh node tools/reel/render.mjs --replay <file> \
#     --formats iphone --title 1.2 --end-card 0 --min-seconds 25 --max-seconds 29.5
#
#   the frames (raw RGBA in):  -preset medium -crf 19
#        ->  -preset slow, about 11 Mbps (cap 12), H.264 High level 4.0, a key frame a
#            second, converted and tagged BT.709 (the reel's own encode is untagged)
#   the sound (the mux):       -c:a aac -b:a 160k (mono, 44.1 kHz)
#        ->  AAC-LC by AudioToolbox (aac_at), constant 256 kbps, stereo, 48 kHz
#            (ffmpeg's own aac at 256k averages about 36 kbps on this mostly quiet
#            sound; Apple asks for 256)
#
# Every other call (the contact sheet's stills) passes through unchanged.
# REAL_FFMPEG names the real ffmpeg (the one on the PATH otherwise); it needs libx264
# and, for aac_at, a Mac.
REAL="${REAL_FFMPEG:-ffmpeg}"
args=()
while (($#)); do
  case "$1" in
    -crf)
      args+=(-b:v 11M -maxrate 12M -bufsize 12M -level:v 4.0 -g 30
             -vf "scale=out_color_matrix=bt709:out_range=tv"
             -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv)
      shift 2 ;;
    -preset)
      args+=(-preset slow); shift 2 ;;
    -c:a)
      args+=(-c:a aac_at -aac_at_mode cbr); shift 2 ;;
    -b:a)
      args+=(-b:a 256k -ac 2 -ar 48000); shift 2 ;;
    *)
      args+=("$1"); shift ;;
  esac
done
exec "$REAL" "${args[@]}"
