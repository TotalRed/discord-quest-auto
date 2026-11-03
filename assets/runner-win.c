/* Minimal native Windows runner. No network, credentials, or persistence.
 * Discord's game detection on Windows ignores windowless background processes,
 * so the runner owns a small top-level window (shown minimized, no focus steal)
 * titled with its own executable name, and pumps messages until it is closed. */
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
#define WS_OVERLAPPEDWINDOW 0x00CF0000
#define SW_SHOWMINNOACTIVE 7
#define CW_USEDEFAULT ((int)0x80000000)

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
    HWND hwnd = CreateWindowExW(0, className, title, WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, CW_USEDEFAULT, 360, 120, 0, 0, inst, 0);
    if (hwnd) ShowWindow(hwnd, SW_SHOWMINNOACTIVE);

    static MSG msg;
    while (GetMessageW(&msg, 0, 0, 0) > 0) { TranslateMessage(&msg); DispatchMessageW(&msg); }
    ExitProcess(0);
}
