import threading
import time
import webbrowser
import urllib.request
import uvicorn

def open_when_ready():
    for _ in range(40):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8765/api/session',timeout=.5) as r:
                if r.status==200:
                    webbrowser.open('http://127.0.0.1:8765')
                    return
        except OSError:
            time.sleep(.25)

if __name__=='__main__':
    threading.Thread(target=open_when_ready,daemon=True).start()
    uvicorn.run('pow_app.server:app',host='127.0.0.1',port=8765,access_log=False)
