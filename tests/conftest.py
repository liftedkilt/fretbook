def pytest_addoption(parser) -> None:
    parser.addoption(
        "--update-golden",
        action="store_true",
        default=False,
        help="rewrite the import corpus snapshots in tests/fixtures/corpus/golden instead of comparing",
    )
