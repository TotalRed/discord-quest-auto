/* Minimal native Windows runner. No network, credentials, or persistence.
 * Discord's game detection on Windows ignores windowless background processes,
 * so the runner owns a small top-level window titled with its own executable name
 * and pumps messages until it is closed. The window is a visible tool window
 * parked off-screen: Discord still sees it, but it stays out of the taskbar and
 * Alt+Tab, so a dozen parallel quests do not flood the taskbar. */
typedef unsigned short wchar;
typedef void *HANDLE;
typedef HANDLE HWND, HINSTANCE, HICON, HCURSOR, HBRUSH, HMENU;
typedef unsigned int UINT;
typedef unsigned long DWORD;
typedef long long LONG_PTR;
typedef unsigned long long UINT_PTR;
typedef LONG_PTR LRESULT, LPARAM;
typedef UINT_PTR WPARAM;
typedef LRESULT (__stdcall *WNDPROC)(HWND, UINT, WPARAM, LPARAM);

typedef struct { UINT style; WNDPROC proc; int cls; int wnd; HINSTANCE inst; HICON icon;
    HCURSOR cursor; HBRUSH background; const wchar *menu; const wchar *name; } WNDCLASSW;
typedef struct { long x, y; } POINT;
typedef struct { HWND hwnd; UINT message; WPARAM w; LPARAM l; DWORD time; POINT pt; DWORD priv; } MSG;

__declspec(dllimport) HINSTANCE __stdcall GetModuleHandleW(const wchar *);
__declspec(dllimport) DWORD __stdcall GetModuleFileNameW(HINSTANCE, wchar *, DWORD);
__declspec(dllimport) void __stdcall ExitProcess(UINT);
__declspec(dllimport) unsigned short __stdcall RegisterClassW(const WNDCLASSW *);
__declspec(dllimport) HWND __stdcall CreateWindowExW(DWORD, const wchar *, const wchar *, DWORD,
    int, int, int, int, HWND, HMENU, HINSTANCE, void *);
__declspec(dllimport) int __stdcall ShowWindow(HWND, int);
__declspec(dllimport) int __stdcall GetMessageW(MSG *, HWND, UINT, UINT);
__declspec(dllimport) int __stdcall TranslateMessage(const MSG *);
__declspec(dllimport) LRESULT __stdcall DispatchMessageW(const MSG *);
__declspec(dllimport) LRESULT __stdcall DefWindowProcW(HWND, UINT, WPARAM, LPARAM);
__declspec(dllimport) void __stdcall PostQuitMessage(int);

#define WM_DESTROY 0x0002
#define WS_POPUP 0x80000000
#define WS_EX_TOOLWINDOW 0x00000080
#define WS_EX_NOACTIVATE 0x08000000
#define SW_SHOWNOACTIVATE 4

static LRESULT __stdcall proc(HWND hwnd, UINT message, WPARAM w, LPARAM l) {
    if (message == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProcW(hwnd, message, w, l);
}

void mainCRTStartup(void) {
    static const wchar className[] = { 'Q','u','e','s','t','R','u','n','n','e','r',0 };
    static wchar path[1024];
    HINSTANCE inst = GetModuleHandleW(0);
    DWORD n = GetModuleFileNameW(0, path, 1024);
    const wchar *title = path;
    for (DWORD i = 0; i < n; i++) if (path[i] == '\\' || path[i] == '/') title = path + i + 1;

    static WNDCLASSW wc;
    wc.proc = proc;
    wc.inst = inst;
    wc.background = (HBRUSH)(UINT_PTR)6; /* COLOR_WINDOW + 1 */
    wc.name = className;
    RegisterClassW(&wc);
    HWND hwnd = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, className, title, WS_POPUP,
        -32000, -32000, 1, 1, 0, 0, inst, 0);
    if (hwnd) ShowWindow(hwnd, SW_SHOWNOACTIVATE);

    static MSG msg;
    while (GetMessageW(&msg, 0, 0, 0) > 0) { TranslateMessage(&msg); DispatchMessageW(&msg); }
    ExitProcess(0);
}
