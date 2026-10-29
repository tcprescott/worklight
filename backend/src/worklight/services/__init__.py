"""The service layer: every feature and permission check lives here, once.

The REST routes (and, later, GraphQL and MCP) are thin adapters that parse input, call a service function
and shape the output. Services raise ServiceError subclasses, which each adapter maps to its own errors.
"""
