#!/bin/bash
docker build -f slave.Dockerfile -t clust-slave .
docker build -f master.Dockerfile -t clust-master .
