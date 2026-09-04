import axios from "axios";
import React, { useEffect, useState } from "react";

const CurrentStatus = ({ status }) => {
    return <li>{status.name}</li>;
};

export default CurrentStatus;
