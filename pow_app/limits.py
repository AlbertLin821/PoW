import ctypes
import os

MB=1024*1024

def available_memory():
    try:
        if os.name=='nt':
            class Memory(ctypes.Structure):
                _fields_=[('length',ctypes.c_ulong),('load',ctypes.c_ulong),*[(name,ctypes.c_ulonglong) for name in ['total','available','page_total','page_available','virtual_total','virtual_available','extended']]]
            status=Memory();status.length=ctypes.sizeof(status)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return status.available
        else:
            return os.sysconf('SC_AVPHYS_PAGES')*os.sysconf('SC_PAGE_SIZE')
    except (AttributeError,OSError,ValueError):
        pass
    return 2*1024*MB

def choose_limits(available=None):
    available=available_memory() if available is None else available
    file_mb=max(32,min(256,available//(64*MB)))
    unpacked_mb=max(128,min(1024,available//(16*MB)))
    return {'file_mb':file_mb,'unpacked_mb':unpacked_mb,'cache_mb':max(128,min(1024,available//(8*MB))),
            'preview_mb':min(file_mb,64),'adaptive':True}

LIMITS=choose_limits()
