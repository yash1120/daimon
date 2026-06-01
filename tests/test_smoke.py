def test_imports():
    from daimon import cli, db, graph, llm  # noqa: F401
    from daimon.personas import available_personas, get_persona

    assert "seneca" in available_personas()
    persona = get_persona("seneca")
    assert "system_prompt" in persona
    assert persona["display_name"] == "Lucius Annaeus Seneca"
