Chat UI harness: copy extensions/caret-ai/media/chat.css, chat.js and logo.png next to index.html, run
  python -m http.server 8791   (in this folder)
open http://localhost:8791/index.html in the browser pane and drive it with window.postMessage({type:'state', ...}, '*').
window.sent holds everything the page posted to the "extension". Resize the pane (resize_window 360x760) to see the real panel width.
