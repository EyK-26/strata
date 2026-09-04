import axios from "axios";
import React, { useEffect, useState } from "react";

const SelectDepartment = ({ department, setDepartment }) => {
	const [departments, setDepartments] = useState([]);
	const loadDepartments = async () => {
		try {
			const response = await axios.get("/api/departments");
			setDepartments(response.data);
		} catch (error) {
			console.log(error.response.data);
		}
	};

	useEffect(() => {
		loadDepartments();
	}, []);

	const handleSelect = (ev) => {
		setDepartment(ev.target.value);
	};

	return (
		<>
			<label className="dropdown-search">
				Department:
				<select
					className="dropdown"
					name="department_id"
					onChange={handleSelect}
					value={department}
				>
					<option value="0">All departments</option>
					{departments
						? departments.map((department) => (
								<option key={department.id} value={department.id}>
									{department.name}
								</option>
						  ))
						: "Loading positions..."}
				</select>
			</label>
		</>
	);
};

export default SelectDepartment;
