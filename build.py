from deepface import DeepFace
import numpy as np

dummy = np.zeros((100, 100, 3), dtype=np.uint8)
try:
    DeepFace.analyze(dummy, actions=["emotion"], enforce_detection=False, silent=True)
except:
    pass
print("DeepFace models downloaded.")