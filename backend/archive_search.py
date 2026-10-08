"""Keyword translations and relevance scoring from SPEC-ARCHIVE V0.3."""
import math
import re

SEARCH_TRANSLATIONS = [
  ['输入电压范围', 'input supply range'], ['供电电压', 'input voltage'], ['输入电压', 'input voltage'], ['输入范围', 'input supply range'], ['电源范围', 'input supply range'],
  ['输出电压', 'output voltage'], ['输出电流', 'output current'], ['负载电流', 'output current'], ['带载能力', 'output current'], ['电流能力', 'output current'], ['最大电流', 'maximum current'],
  ['开关频率', 'switching frequency'], ['工作频率', 'operating frequency'], ['转换效率', 'efficiency'], ['效率', 'efficiency'],
  ['同步降压', 'synchronous step-down'], ['降压转换', 'step-down'], ['降压', 'step-down'], ['升压转换', 'step-up'], ['升压', 'step-up'],
  ['低压差', 'low dropout'], ['低功耗', 'power save'], ['省电模式', 'power save'], ['静态电流', 'quiescent current'], ['待机电流', 'standby current'],
  ['纹波', 'ripple'], ['负载调整率', 'load regulation'], ['线性调整率', 'line regulation'],
  ['软启动', 'soft start'], ['使能', 'enable'], ['关断', 'shutdown'],
  ['过流保护', 'overcurrent protection'], ['过温保护', 'thermal shutdown'], ['短路保护', 'short circuit protection'], ['欠压保护', 'undervoltage lockout'], ['发热', 'thermal'],
  ['封装', 'package'], ['引脚', 'pin'], ['电感', 'inductor'], ['电容', 'capacitor'], ['电阻', 'resistor'], ['参考电压', 'reference voltage'], ['数据手册', 'datasheet']
]


def search_variants(query):
    normalized = str(query or "").lower().strip()
    translated = normalized
    for chinese, english in SEARCH_TRANSLATIONS:
        translated = translated.replace(chinese, " " + english + " ")
    return list(dict.fromkeys([normalized, re.sub(r"\s+", " ", translated).strip()]))


def query_matches(haystack, query):
    haystack = haystack.lower()
    return all(any(variant in haystack for variant in search_variants(term))
               for term in re.split(r"[\s,，;；/]+", str(query).lower().strip()) if term)


def score_document(haystack, question):
    haystack = haystack.lower()
    stop_words = {"what", "which", "with", "this", "that", "the", "and", "for", "how", "can", "does", "please"}
    score = 0
    for variant in search_variants(question):
        terms = {term for term in re.findall(r"[a-z][a-z0-9.-]*|\d+(?:\.\d+)?(?:v|a|ma|ua|mhz|khz|w)?", variant)
                 if len(term) > 1 and term not in stop_words}
        matched = sum(term in haystack for term in terms)
        if matched >= max(1, math.ceil(len(terms) * .6)):
            score = max(score, matched + (2 if len(variant) > 3 and variant in haystack else 0))
    return score
