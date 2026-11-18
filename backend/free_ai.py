"""Isolated OpenRouter free routing. Never reads Codex or generic AI credentials."""
import json
import os
import re
import stat
from decimal import Decimal, InvalidOperation
from pathlib import Path

BASE_URL = 'https://openrouter.ai/api/v1'
CREDENTIALS_FILE = Path(__file__).resolve().parent.parent / 'data/free-ai-providers.json'


def configuration(limits, error=''):
    model = os.environ.get('PORTOPS_AI_MODEL', 'openrouter/free').strip()
    key = os.environ.get('OPENROUTER_API_KEY', '').strip()
    if not key:
        try:
            path = Path(os.environ.get('PORTOPS_AI_CREDENTIALS_FILE', str(CREDENTIALS_FILE)))
            if stat.S_IMODE(path.stat().st_mode) & 0o077 or path.stat().st_size > 65536:
                raise ValueError()
            key = json.loads(path.read_text())['credentials']['openrouter']
            if not isinstance(key, str):
                raise ValueError()
            key = key.strip()
        except (OSError, ValueError, KeyError, TypeError):
            error = 'Configure a private OpenRouter credential file (mode 600) or OPENROUTER_API_KEY.'
    if not key:
        error = 'The free-only OpenRouter API key is missing.'
    if (model != 'openrouter/free' and not re.fullmatch(r'[\w.-]+/[\w.-]+:free', model)) or 'codex' in model.lower():
        error = 'Free-only AI requires openrouter/free or an explicit :free model. Codex and paid models are blocked.'
    base = os.environ.get('PORTOPS_AI_BASE_URL', BASE_URL).strip().rstrip('/')
    if base != BASE_URL or os.environ.get('PORTOPS_AI_PROTOCOL', 'openai').strip().lower() != 'openai':
        error = 'Free-only AI uses the fixed OpenRouter HTTPS endpoint and chat protocol.'
    return dict(provider='openrouter_free', model=model, base=BASE_URL, key=key,
                vision=False, protocol='openai', limits=limits, external=True,
                host='openrouter.ai', error=error, free_only=True)


def secure_request(config, url, payload):
    if config['error']:
        raise ValueError(config['error'])
    if url != BASE_URL + '/chat/completions' or payload.get('model') != config['model']:
        raise ValueError('Free-only AI blocked an unexpected endpoint or model.')
    if any(field in payload for field in ('models', 'plugins', 'tools')):
        raise ValueError('Free-only AI does not allow alternate models, plugins or tools.')
    # Apply at the HTTP boundary, including for any future callers of _post.
    payload = dict(payload)
    payload['provider'] = {'max_price': {'prompt': 0, 'completion': 0, 'request': 0, 'image': 0},
                           'allow_fallbacks': False, 'require_parameters': True}
    payload['usage'] = {'include': True}
    return payload


def verify_cost(response):
    usage = response.get('usage')
    cost = usage.get('cost') if isinstance(usage, dict) else None
    try:
        value = Decimal(str(cost))
        if isinstance(cost, bool) or not value.is_finite() or value != 0:
            raise InvalidOperation()
    except (InvalidOperation, ValueError):
        raise ValueError('The AI provider did not confirm zero cost. No result was accepted and no alternate model was called.') from None
