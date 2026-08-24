"""Production WSGI entry point for SwapLabs."""


from swaplabs_server import app, read_store, start_reminder_worker


read_store()
start_reminder_worker()

