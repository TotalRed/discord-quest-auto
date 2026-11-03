/* Minimal native Windows runner. No network, credentials, or persistence. */
__declspec(dllimport) void __stdcall Sleep(unsigned long milliseconds);
void mainCRTStartup(void) {
    for (;;) Sleep(60000);
}
