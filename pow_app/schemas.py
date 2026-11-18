from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

Role = Literal['body', 'heading1', 'heading2', 'heading3', 'heading4', 'keep']

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

class Profile(StrictModel):
    chinese_font: str = Field(default='標楷體', min_length=1, max_length=80)
    latin_font: str = Field(default='Times New Roman', min_length=1, max_length=80)
    body_size: float = Field(default=12, ge=6, le=72)
    heading1: float = Field(default=18, ge=6, le=72)
    heading2: float = Field(default=16, ge=6, le=72)
    heading3: float = Field(default=14, ge=6, le=72)
    heading4: float = Field(default=14, ge=6, le=72)
    first_line_chars: float = Field(default=2, ge=0, le=10)
    line_spacing: float = Field(default=1, ge=0.5, le=3)
    paragraph_after: float = Field(default=0, ge=0, le=72)
    alignment: Literal['both', 'left', 'center', 'right'] = 'both'
    top: float = Field(default=2, ge=0.5, le=5)
    bottom: float = Field(default=3, ge=0.5, le=5)
    left: float = Field(default=3, ge=0.5, le=5)
    right: float = Field(default=2, ge=0.5, le=5)
    new_page_chapters: bool = True

class Selection(StrictModel):
    paragraph_id: str = Field(max_length=30)
    role: Role

class ExportRequest(StrictModel):
    profile: Profile
    selections: list[Selection] = Field(max_length=2000)
    clean_leading: bool = False

class Provider(StrictModel):
    kind: Literal['ollama', 'openai', 'compatible'] = 'ollama'
    endpoint: str = Field(default='http://127.0.0.1:11434', max_length=300)
    model: str = Field(default='', max_length=160)
    api_key: str = Field(default='', max_length=512)

class Suggestion(StrictModel):
    paragraph_id: str
    role: Role
    reason: str = Field(max_length=500)
    needs_review: bool = True

class SuggestionList(StrictModel):
    suggestions: list[Suggestion] = Field(max_length=2000)

class AIRequest(StrictModel):
    profile: Profile
    model: str = Field(min_length=1, max_length=160)
