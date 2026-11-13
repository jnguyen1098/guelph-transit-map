# Exact function from Jason's shared web_session.py (2026-11-11).
def unheadless_user_agent(ua):
    """The browser's own UA with HeadlessChrome -> Chrome, nothing else.
    Refuses if no Chrome token.
    """
    if not ua or ("Chrome/" not in ua):
        raise ValueError("not a Chrome User-Agent: %r" % (ua,))
    return ua.replace("HeadlessChrome/", "Chrome/")

if __name__ == '__main__':
    import sys
    print(unheadless_user_agent(sys.argv[1]))
